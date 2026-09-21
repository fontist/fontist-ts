import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { FONTIST_VERSION } from '../context.js';
import {
  FontistVersionError,
  LicensingError,
  PlatformMismatchError,
} from '../errors/errors.js';
import { compareVersions, fnmatchSuffix } from '../util/compare.js';
import { FormatMatcher, DESKTOP_FORMATS } from '../formula/formatMatcher.js';
import type { FormatSpec } from '../formula/formatSpec.js';
import type { Formula } from '../formula/formula.js';
import type { FontStyle, Resource } from '../formula/models.js';
import {
  createInstallLocation,
  type BaseLocation,
  type InstallLocationType,
} from '../locations/installLocation.js';
import {
  defaultTranscoderRegistry,
  checkTranscodeLicense,
} from './transcode.js';
import { ResourceInstallerRegistry } from './resourceInstallers.js';

export interface FontInstallerOptions {
  fontName?: string | null;
  noProgress?: boolean;
  location?: InstallLocationType | null;
  formatSpec?: FormatSpec | null;
  confirmation?: string | null;
}

/** Installs a formula: gates (platform, fontist version, license) followed by
 * resource download/extraction and copying matched files into the location. */
export class FontInstaller {
  private readonly ctx: FontistContext;
  private readonly formula: Formula;
  private readonly fontName: string | null;
  private readonly noProgress: boolean;
  private readonly location: BaseLocation;
  private readonly formatSpec: FormatSpec | null;
  private readonly confirmationOption: string | null;
  private readonly resourceInstallers = new ResourceInstallerRegistry();
  private confirmation: string | null = null;

  constructor(ctx: FontistContext, formula: Formula, options: FontInstallerOptions = {}) {
    this.ctx = ctx;
    this.formula = formula;
    this.fontName = options.fontName ?? null;
    this.noProgress = options.noProgress ?? false;
    this.location = createInstallLocation(options.location ?? null, ctx, formula);
    this.formatSpec = options.formatSpec ?? null;
    this.confirmationOption = options.confirmation ?? null;
  }

  async install(confirmation: string | null = null): Promise<string[] | null> {
    this.confirmation = confirmation ?? this.confirmationOption;
    this.checkPlatform();
    this.checkFontistVersion();
    this.checkLicense();
    return this.doInstall();
  }

  private checkPlatform(): void {
    if (!this.formula.compatibleWithPlatform(this.ctx.platform)) {
      throw new PlatformMismatchError(
        this.fontName ?? this.formula.name ?? this.formula.key(),
        this.formula.platforms,
        this.ctx.platform,
      );
    }
  }

  private checkFontistVersion(): void {
    const min = this.formula.minFontist;
    if (min !== null && compareVersions(FONTIST_VERSION, min) < 0) {
      throw new FontistVersionError(
        `Formula "${this.formula.key()}" requires fontist >= ${min}, ` +
          `but the current version is ${FONTIST_VERSION}. Please upgrade fontist.`,
      );
    }
  }

  private checkLicense(): void {
    if (!this.formula.licenseRequired()) return;
    if (this.formula.licensedForCurrentPlatform(this.ctx.platform)) return;
    if (this.confirmation?.toLowerCase() !== 'yes') {
      throw new LicensingError();
    }
  }

  private async doInstall(): Promise<string[] | null> {
    const resource = this.resourceOptions();
    if (resource === null) return null;

    const sourceNames = this.sourceFiles();
    const targetNames = this.targetFilenames();
    const installed: string[] = [];
    const installer = this.resourceInstallers.create(
      resource.source,
      this.ctx,
      resource,
      { noProgress: this.noProgress },
    );

    await installer.files(sourceNames, async (filePath) => {
      if (!this.isFontFile(filePath)) return;
      const base = path.basename(filePath);
      const targetName = targetNames.get(base) ?? base;
      installed.push(await this.installFontFile(filePath, targetName));
    });

    return installed.length > 0 ? installed : null;
  }

  /** The single resource to install (Ruby `resource_options`). */
  private resourceOptions(): Resource | null {
    const resources = this.formula.resources;
    if (resources.length === 0) return null;
    if (resources.length === 1 || !this.formula.isV5()) {
      return resources[0]!;
    }
    if (this.formatSpec?.hasConstraints()) {
      return new FormatMatcher(this.formatSpec).selectPreferredResource(resources);
    }
    return (
      resources.find((r) => r.format !== null && DESKTOP_FORMATS.includes(r.format)) ??
      resources[0]!
    );
  }

  /** basename of the extracted file -> target install name. */
  private targetFilenames(): Map<string, string> {
    const map = new Map<string, string>();
    for (const style of this.styles()) {
      const source = style.sourceFont ?? style.font;
      if (source && style.font) {
        map.set(source, style.font);
      }
    }
    return map;
  }

  /** Candidate filenames the resource must provide. */
  private sourceFiles(): string[] {
    let styles = this.styles();
    if (this.formatSpec?.hasConstraints() && this.formula.isV5()) {
      styles = new FormatMatcher(this.formatSpec).filterStyles(styles);
    }
    const fileNames = styles
      .map((s) => s.sourceFont ?? s.font)
      .filter((f): f is string => f !== null);

    if (this.formula.isV5() && this.resourceOptions()?.source === 'google' && fileNames.length > 0) {
      const basenames = (this.resourceOptions()?.files ?? []).map((f) => path.basename(f));
      if (!fileNames.some((f) => basenames.includes(f))) {
        return basenames;
      }
    }
    return fileNames;
  }

  private styles(): FontStyle[] {
    return this.formula
      .allFonts()
      .filter(
        (font) =>
          this.fontName === null ||
          font.name?.toLowerCase() === this.fontName.toLowerCase(),
      )
      .flatMap((font) => font.styles);
  }

  /** Extracted path qualifies when its basename is a source file and it lives
   * under a declared fonts subdirectory (when any). */
  private isFontFile(filePath: string): boolean {
    return this.isSourceFile(filePath) && this.isInFontDirectory(filePath);
  }

  private isSourceFile(filePath: string): boolean {
    return this.sourceFiles().includes(path.basename(filePath));
  }

  private isInFontDirectory(filePath: string): boolean {
    const pattern = this.subdirectoryPattern();
    if (pattern === null) return true;
    return fnmatchSuffix(pattern, path.dirname(filePath));
  }

  private subdirectoryPattern(): string | null {
    const subdirs = this.formula.extract
      .flatMap((extract) => extract.options)
      .map((option) => option.fontsSubDir)
      .filter((dir): dir is string => dir !== null)
      .map((dir) => dir.replace(/\/+$/, ''));
    if (subdirs.length === 0) return null;
    return `*${subdirs[0]}`;
  }

  private async installFontFile(sourcePath: string, targetName: string): Promise<string> {
    const sourceFormat = detectFontFormat(sourcePath);
    const requestedFormat = this.formatSpec?.format ?? null;
    if (requestedFormat !== null && requestedFormat !== sourceFormat) {
      checkTranscodeLicense(this.confirmation);
      return this.installWithConversion(sourcePath, targetName, sourceFormat, requestedFormat);
    }
    return this.location.installFont(sourcePath, targetName);
  }

  private async installWithConversion(
    sourcePath: string,
    targetName: string,
    sourceFormat: string,
    requestedFormat: string,
  ): Promise<string> {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-transcode-'));
    try {
      const transcoder = defaultTranscoderRegistry().require(sourceFormat, requestedFormat);
      const converted = await transcoder.convert(sourcePath, requestedFormat, {
        outputDir,
        keepOriginal: true,
      });
      return await this.location.installFont(converted, targetName);
    } finally {
      await fsp.rm(outputDir, { recursive: true, force: true });
    }
  }

  locationType(): InstallLocationType {
    return this.location.locationType();
  }

  /** The target location (for permission warnings before install). */
  getLocation(): BaseLocation {
    return this.location;
  }
}

function detectFontFormat(filePath: string): string {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  return ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc', 'dfont'].includes(extension)
    ? extension
    : 'ttf';
}
