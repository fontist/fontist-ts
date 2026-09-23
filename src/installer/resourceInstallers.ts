import * as path from 'node:path';
import { existsSync } from 'node:fs';
import type { FontistContext } from '../context.js';
import type { Resource } from '../formula/models.js';
import {
  FontistError,
  InvalidResourceError,
  WindowsFodInstallError,
} from '../errors/errors.js';
import {
  runPowershell,
  type RunPowershell,
} from '../system/systemUtils.js';
import { Archive } from '../extract/archive.js';
import { Downloader } from '../download/downloader.js';

export interface ResourceInstallOptions {
  noProgress?: boolean;
}

/** Installs the files of a resource: downloads, extracts, and yields each
 * candidate font file path to the consumer callback. */
export abstract class ResourceInstaller {
  constructor(
    protected readonly ctx: FontistContext,
    protected readonly resource: Resource,
    protected readonly options: ResourceInstallOptions,
  ) {}

  /** Extracts the resource and invokes `onFile` per candidate file. */
  abstract files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void>;

  protected async download(urls: string[], sha256: string[], fileSize: number | null): Promise<string> {
    const downloader = new Downloader(this.ctx);
    const errors: string[] = [];
    for (const url of urls) {
      this.ctx.ui.say(`Downloading from ${url}`);
      try {
        const result = await downloader.download(url, {
          sha256: sha256.length > 0 ? sha256 : undefined,
          fileSize,
          progress: !this.options.noProgress,
        });
        return result.path;
      } catch (err) {
        if (err instanceof InvalidResourceError) {
          errors.push(err.message);
          this.ctx.ui.say(err.message);
          continue;
        }
        throw err;
      }
    }
    throw new InvalidResourceError(errors.join(' '));
  }
}

/** Generic archive resource: recursive extraction (Ruby ArchiveResource). */
export class ArchiveResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    void sourceNames;
    const archivePath = await this.download(this.resource.urls, this.resource.sha256, this.resource.fileSize);
    const archive = new Archive();
    const tmpDir = `${archivePath}-extracted`;
    const extracted = await archive.extractAll(archivePath, tmpDir, { recursivePackages: true });
    for (const file of extracted) {
      await onFile(file);
    }
  }
}

/** Google Fonts resource: `resource.files` are direct font URLs; matched by
 * source filename and downloaded individually (no archives involved). */
export class GoogleResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    const urls = this.resource.files.filter((url) =>
      sourceNames.includes(path.basename(url)),
    );
    for (const url of urls) {
      this.ctx.ui.say(`Downloading from ${url}`);
      const downloader = new Downloader(this.ctx);
      const result = await downloader.download(url, { progress: !this.options.noProgress });
      await onFile(result.path);
    }
  }
}

/** Apple CDN resource: plain URL download into the macOS system location. */
export class AppleCdnResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    if (this.ctx.platform !== 'macos') {
      throw new FontistError(
        'apple_cdn resources are only supported on macOS; use FONTIST_PLATFORM_OVERRIDE to test.',
      );
    }
    const archivePath = await this.download(this.resource.urls, this.resource.sha256, this.resource.fileSize);
    const archive = new Archive();
    const tmpDir = `${archivePath}-extracted`;
    const extracted = await archive.extractAll(archivePath, tmpDir, { recursivePackages: true });
    for (const file of extracted) {
      if (sourceNames.length === 0 || sourceNames.includes(path.basename(file))) {
        await onFile(file);
      }
    }
  }
}

/** Windows Font-on-Demand resource: installs the Windows capability via
 * PowerShell when missing, then yields the fonts Windows placed into
 * %windir%/Fonts (Ruby WindowsFodResource). */
export class WindowsFodResourceInstaller extends ResourceInstaller {
  constructor(
    ctx: FontistContext,
    resource: Resource,
    options: ResourceInstallOptions,
    private readonly powershell: RunPowershell = defaultPowershell,
  ) {
    super(ctx, resource, options);
  }

  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    const capName = this.resource.capabilityName;
    if (!capName) {
      throw new FontistError('windows_fod resource requires capability_name');
    }

    if (!(await this.capabilityInstalled(capName))) {
      this.ctx.ui.say(`Installing Windows font capability: ${capName}`);
      const result = await this.powershell(
        `Add-WindowsCapability -Online -Name '${psEscape(capName)}'`,
      );
      if (!result.success) {
        throw new WindowsFodInstallError(capName, result.stderr);
      }
    }

    const windir = this.ctx.env['windir'] ?? this.ctx.env['SystemRoot'] ?? 'C:/Windows';
    const fontsDir = path.join(windir, 'Fonts');
    for (const filename of sourceNames) {
      const candidate = path.join(fontsDir, filename);
      if (existsSync(candidate)) {
        await onFile(candidate);
      }
    }
  }

  private async capabilityInstalled(name: string): Promise<boolean> {
    const result = await this.powershell(
      `(Get-WindowsCapability -Online -Name '${psEscape(name)}').State`,
    );
    return result.stdout.trim() === 'Installed';
  }
}

function psEscape(value: string): string {
  // Escape single quotes for PowerShell single-quoted strings.
  return value.replaceAll("'", "''");
}

function defaultPowershell(command: string): ReturnType<typeof runPowershell> {
  return runPowershell(command);
}

/** Registry keyed by the formula resource `source` (OCP: new sources
 * register here; the installer pipeline is untouched). */
export class ResourceInstallerRegistry {
  private readonly factories = new Map<
    string,
    new (ctx: FontistContext, resource: Resource, options: ResourceInstallOptions) => ResourceInstaller
  >();

  constructor() {
    this.register('archive', ArchiveResourceInstaller);
    this.register('google', GoogleResourceInstaller);
    this.register('apple_cdn', AppleCdnResourceInstaller);
    this.register('windows_fod', WindowsFodResourceInstaller);
  }

  register(
    source: string,
    factory: new (ctx: FontistContext, resource: Resource, options: ResourceInstallOptions) => ResourceInstaller,
  ): this {
    this.factories.set(source, factory);
    return this;
  }

  create(
    source: string | null,
    ctx: FontistContext,
    resource: Resource,
    options: ResourceInstallOptions,
  ): ResourceInstaller {
    const key = source ?? 'archive';
    const factory = this.factories.get(key);
    if (!factory) {
      throw new InvalidResourceError(`No resource installer registered for source "${key}"`);
    }
    return new factory(ctx, resource, options);
  }
}
