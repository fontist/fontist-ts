import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistPlatform } from '../ui/ui.js';
import type { FontistContext } from '../context.js';
import type { Formula } from '../formula/formula.js';
import { FontistError } from '../errors/errors.js';
import { FontistIndex, SystemIndex, UserIndex } from '../index/installed/collectionIndexes.js';
import type { BaseFontCollectionIndex } from '../index/installed/baseFontCollectionIndex.js';
import { copyFileTo, mkdirp, pathExists, removeFile } from '../util/fsx.js';
import { macosImportSystemPathSync } from './macosFramework.js';

export type InstallLocationType = 'fontist' | 'user' | 'system';

/** Behavior shared by all install targets: dedup-aware install, uninstall,
 * index bookkeeping, and permission warnings. */
export abstract class BaseLocation {
  constructor(
    protected readonly ctx: FontistContext,
    protected readonly formula: Formula | null,
  ) {}

  abstract basePath(): string;
  abstract locationType(): InstallLocationType;

  /** The installed-font index tracking this location's fonts (null when the
   * location is not indexable). */
  protected abstract index(): BaseFontCollectionIndex | null;

  /** Whether fonts here are managed by Fontist (safe to replace silently). */
  managedPath(): boolean {
    return true;
  }

  requiresElevatedPermissions(): boolean {
    return false;
  }

  permissionWarning(): string | null {
    return null;
  }

  /** Installs `sourcePath` as `targetName`; returns the installed path. */
  async installFont(sourcePath: string, targetName: string): Promise<string> {
    const target = path.join(this.basePath(), targetName);
    if (await pathExists(target)) {
      if (this.managedPath()) {
        await copyFileTo(sourcePath, target);
        await this.registerFont(target);
        this.ctx.ui.say(`Replaced font in ${target}`);
        return target;
      }
      const unique = await this.generateUniqueFilename(targetName);
      const uniqueTarget = path.join(this.basePath(), unique);
      await copyFileTo(sourcePath, uniqueTarget);
      await this.registerFont(uniqueTarget);
      this.ctx.ui.warn(
        `Font "${targetName}" already exists in ${this.basePath()}; installed as "${unique}".`,
      );
      return uniqueTarget;
    }
    await mkdirp(this.basePath());
    await copyFileTo(sourcePath, target);
    await this.registerFont(target);
    return target;
  }

  async uninstallFont(fileName: string): Promise<string | null> {
    const target = path.join(this.basePath(), fileName);
    if (!(await pathExists(target))) return null;
    if (!(await removeFile(target))) return null;
    await this.index()?.removeFont(target);
    return target;
  }

  private async registerFont(target: string): Promise<void> {
    try {
      await this.index()?.addFont(target);
    } catch (err) {
      this.ctx.ui.debug(`Font installed but could not be indexed: ${String(err)}`);
    }
  }

  private async generateUniqueFilename(targetName: string): Promise<string> {
    const extension = path.extname(targetName);
    const stem = targetName.slice(0, targetName.length - extension.length);
    const candidate =
      extension.length > 0 ? `${stem}-fontist${extension}` : `${stem}-fontist`;
    if (!(await pathExists(path.join(this.basePath(), candidate)))) {
      return candidate;
    }
    for (let i = 2; i < 1000; i++) {
      const numbered = `${candidate}-${i}`;
      if (!(await pathExists(path.join(this.basePath(), numbered)))) {
        return numbered;
      }
    }
    throw new FontistError(`Could not generate unique filename for ${targetName}`);
  }
}

/** `~/.fontist/fonts/{formula-key}` — the default, fully managed location. */
export class FontistLocation extends BaseLocation {
  override basePath(): string {
    return path.join(this.ctx.paths.fontsPath(), this.formula?.key() ?? '');
  }

  override locationType(): InstallLocationType {
    return 'fontist';
  }

  protected override index(): BaseFontCollectionIndex {
    return new FontistIndex(this.ctx);
  }
}

/** The platform user font directory, optionally suffixed with `fontist`. */
export class UserLocation extends BaseLocation {
  override basePath(): string {
    const custom = this.ctx.config.get('user_fonts_path');
    if (custom) return custom;
    return path.join(defaultUserFontPath(this.ctx.platform, this.ctx.env), 'fontist');
  }

  override locationType(): InstallLocationType {
    return 'user';
  }

  override managedPath(): boolean {
    const custom = this.ctx.config.get('user_fonts_path');
    if (!custom) return true;
    const normalized = custom.replace(/\\/g, '/');
    return normalized.endsWith('/fontist');
  }

  protected override index(): BaseFontCollectionIndex {
    return new UserIndex(this.ctx, this.basePath());
  }
}

/** The platform system font directory (requires elevated permissions). */
export class SystemLocation extends BaseLocation {
  override basePath(): string {
    const custom = this.ctx.config.get('system_fonts_path');
    if (custom) return custom;
    switch (this.ctx.platform) {
      case 'macos':
        return '/Library/Fonts/fontist';
      case 'linux':
        return '/usr/local/share/fonts/fontist';
      case 'windows': {
        const windir = this.ctx.env.windir || this.ctx.env.SystemRoot || 'C:/Windows';
        return path.join(windir, 'Fonts', 'fontist');
      }
    }
  }

  override locationType(): InstallLocationType {
    return 'system';
  }

  override managedPath(): boolean {
    const custom = this.ctx.config.get('system_fonts_path');
    if (custom) {
      const normalized = custom.replace(/\\/g, '/');
      return normalized.endsWith('/fontist');
    }
    return this.formula?.isMacosImport() ?? true;
  }

  override requiresElevatedPermissions(): boolean {
    return true;
  }

  override permissionWarning(): string | null {
    return (
      'Installing to the system font directory requires elevated permissions.\n' +
      `Fontist will copy fonts into:\n  ${this.basePath()}\n` +
      'You may be prompted for your password; cancel now to install elsewhere (e.g. --location fontist).'
    );
  }

  protected override index(): BaseFontCollectionIndex | null {
    return new SystemIndex(this.ctx);
  }
}

/** macOS supplementary (import) fonts install into their MobileAsset dirs. */
export class MacosImportLocation extends SystemLocation {
  override basePath(): string {
    if (this.formula === null) {
      throw new FontistError('macOS import location requires the formula');
    }
    return macosImportSystemPathSync(this.formula);
  }
}

/** Maps a location type (or the config default) to a location instance. */
export function createInstallLocation(
  type: InstallLocationType | null | undefined,
  ctx: FontistContext,
  formula: Formula | null = null,
): BaseLocation {
  const resolved = type ?? ctx.config.get('fonts_install_location') ?? 'fontist';
  switch (resolved) {
    case 'fontist':
      return new FontistLocation(ctx, formula);
    case 'user':
      return new UserLocation(ctx, formula);
    case 'system':
      return formula?.isMacosImport() && ctx.platform === 'macos'
        ? new MacosImportLocation(ctx, formula)
        : new SystemLocation(ctx, formula);
    default:
      ctx.ui.error(`Unknown install location "${String(resolved)}", falling back to "fontist".`);
      return new FontistLocation(ctx, formula);
  }
}

export function defaultUserFontPath(
  platform: FontistPlatform,
  env: NodeJS.ProcessEnv,
): string {
  switch (platform) {
    case 'macos':
      return path.join(os.homedir(), 'Library', 'Fonts');
    case 'linux':
      return path.join(os.homedir(), '.local', 'share', 'fonts');
    case 'windows': {
      const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(localAppData, 'Microsoft', 'Windows', 'Fonts');
    }
  }
}
