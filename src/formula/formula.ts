import {
  GoogleImportSource,
  IMPORT_SOURCE_REGISTRY,
  ImportSource,
  MacosImportSource,
  SilImportSource,
  WindowsImportSource,
} from './importSources.js';
import { FormatMatcher } from './formatMatcher.js';
import type {
  FontStyle} from './models.js';
import {
  Extract,
  FontCollection,
  FontModel,
  Resource
} from './models.js';
import { type ModelDefinition, SerializableModel } from '../serialization/model.js';
import type { FormatSpec } from './formatSpec.js';
import { catalogVersionForMacos, macosVersion, userOs } from '../system/systemUtils.js';
import { macosFrameworkMetadata } from '../import/macos/frameworkMetadata.js';
import { UnsupportedMacOSVersionError } from '../errors/errors.js';

/** The central formula data model — a YAML recipe describing how to download
 * and install fonts. v4 formulas lack `schema_version`; v5 formulas declare
 * `schema_version: 5` with multi-format metadata. */
export class Formula extends SerializableModel {
  declare schemaVersion: number | null;
  declare name: string | null;
  declare description: string | null;
  declare homepage: string | null;
  declare displayProgressBar: boolean | null;
  declare repository: string | null;
  declare copyright: string | null;
  declare licenseUrl: string | null;
  declare openLicense: string | null;
  declare requiresLicenseAgreement: string | null;
  declare spdxLicense: string | null;
  declare platforms: string[];
  declare minFontist: string | null;
  declare digest: string | null;
  declare instructions: string | null;
  declare resources: Resource[];
  declare fontCollections: FontCollection[];
  declare fonts: FontModel[];
  declare extract: Extract[];
  declare command: string | null;
  declare importSource: ImportSource | null;
  declare fontVersion: string | null;

  /** Absolute path of the YAML file this formula was loaded from (not serialized). */
  path: string | null = null;

  /** Key derived from the path relative to the Formulas root; assigned by the
   * repository when loading (not serialized). */
  keyValue: string | null = null;

  static override define(d: ModelDefinition) {
    d.attribute('schemaVersion', 'integer', {
      omitWhen: (instance) => (instance as Formula).schemaVersion !== 5,
    });
    d.attribute('name', 'string');
    d.attribute('description', 'string');
    d.attribute('homepage', 'string');
    d.attribute('displayProgressBar', 'boolean');
    d.attribute('repository', 'string');
    d.attribute('copyright', 'string');
    d.attribute('licenseUrl', 'string');
    d.attribute('openLicense', 'string');
    d.attribute('requiresLicenseAgreement', 'string');
    d.attribute('spdxLicense', 'string');
    d.attribute('platforms', 'string', { collection: true, default: () => [] });
    d.attribute('minFontist', 'string');
    d.attribute('digest', 'string');
    d.attribute('instructions', 'string');
    d.attribute('resources', Resource, { collection: true, default: () => [] });
    d.attribute('fontCollections', FontCollection, { collection: true, default: () => [] });
    d.attribute('fonts', FontModel, { collection: true, default: () => [] });
    d.attribute('extract', Extract, { collection: true, default: () => [] });
    d.attribute('command', 'string');
    d.attribute('importSource', ImportSource);
    d.attribute('fontVersion', 'string');

    d.mapping('schemaVersion', { to: 'schema_version' });
    d.mapping('name');
    d.mapping('description');
    d.mapping('homepage');
    d.mapping('displayProgressBar', { to: 'display_progress_bar' });
    d.mapping('repository');
    d.mapping('copyright');
    d.mapping('licenseUrl', { to: 'license_url' });
    d.mapping('openLicense', { to: 'open_license' });
    d.mapping('requiresLicenseAgreement', { to: 'requires_license_agreement' });
    d.mapping('spdxLicense', { to: 'spdx_license' });
    d.mapping('platforms');
    d.mapping('minFontist', { to: 'min_fontist' });
    d.mapping('digest');
    d.mapping('instructions');
    d.mapping('resources', { childKeyTo: 'name' });
    d.mapping('fontCollections', { to: 'font_collections' });
    d.mapping('fonts');
    d.mapping('extract');
    d.mapping('command');
    d.mapping('importSource', {
      to: 'import_source',
      polymorphicTag: 'type',
      polymorphicRegistry: IMPORT_SOURCE_REGISTRY,
    });
    d.mapping('fontVersion', { to: 'font_version' });
  }

  isV5(): boolean {
    return this.schemaVersion === 5;
  }

  effectiveSchemaVersion(): number {
    return this.schemaVersion ?? 4;
  }

  key(): string {
    return this.keyValue ?? '';
  }

  license(): string | null {
    return this.openLicense ?? this.requiresLicenseAgreement;
  }

  licenseRequired(): boolean {
    return this.requiresLicenseAgreement != null;
  }

  isDownloadable(): boolean {
    return this.resources.length > 0;
  }

  isManual(): boolean {
    return !this.isDownloadable();
  }

  isMacosImport(): boolean {
    return this.importSource instanceof MacosImportSource;
  }

  isGoogleImport(): boolean {
    return this.importSource instanceof GoogleImportSource;
  }

  isSilImport(): boolean {
    return this.importSource instanceof SilImportSource;
  }

  isWindowsImport(): boolean {
    return this.importSource instanceof WindowsImportSource;
  }

  source(): string | null {
    return this.resources[0]?.source ?? null;
  }

  fileSize(): number | null {
    return this.resources[0]?.fileSize ?? null;
  }

  /** Whether the current platform matches the formula's declared platforms
   * (exact match or `os-` prefixed entry; formulas without platforms allow
   * all). macOS-import formulas additionally require the current macOS
   * version to map to a known font framework. */
  compatibleWithPlatform(platform: string): boolean {
    if (this.platforms.length === 0) return true;
    const platformMatches = this.platforms.some(
      (p) => p === platform || p.startsWith(`${platform}-`),
    );
    if (!platformMatches) return false;

    if (platform === 'macos' && this.isMacosImport()) {
      const currentMacos = macosVersion();
      if (!currentMacos) return true;

      const framework = catalogVersionForMacos();
      if (framework === null) {
        throw new UnsupportedMacOSVersionError(currentMacos, macosFrameworkMetadata());
      }
      return (this.importSource as MacosImportSource).compatibleWithMacos(currentMacos);
    }

    return true;
  }

  /** Ruby `compatible_with_current_platform?`: only macOS-import formulas
   * are gated by the running macOS version. */
  compatibleWithCurrentPlatform(): boolean {
    if (!this.isMacosImport()) return true;
    const currentMacos = macosVersion();
    if (!currentMacos) return true;
    return (this.importSource as MacosImportSource).compatibleWithMacos(currentMacos);
  }

  /** Human-readable explanation of why the formula does not match the
   * current platform (Ruby platform_restriction_message). The platform
   * parameter is injectable for callers that resolve it from context. */
  platformRestrictionMessage(platform: string = userOs()): string | null {
    if (this.compatibleWithPlatform(platform)) return null;

    const current = platform;
    let message = `Font '${this.name}' is only available for: ${this.platforms.join(', ')}. `;
    message += `Your current platform is: ${current}.`;

    if (current === 'macos' && this.isMacosImport()) {
      const source = this.importSource as MacosImportSource;
      const currentVersion = macosVersion();
      if (currentVersion) {
        message += ` Your macOS version is: ${currentVersion}.`;
      }
      const minVersion = source.minMacosVersion();
      const maxVersion = source.maxMacosVersion();
      if (minVersion && maxVersion) {
        message += ` This font requires macOS ${minVersion} to ${maxVersion}.`;
      } else if (minVersion) {
        message += ` This font requires macOS ${minVersion} or later.`;
      } else if (maxVersion) {
        message += ` This font requires macOS ${maxVersion} or earlier.`;
      }
    }

    message += ' This font cannot be installed on your system.';
    return message;
  }

  /** Ruby `licensed_for_current_platform?`: formulas restricted to platforms
   * that include the current OS are considered already licensed there. */
  licensedForCurrentPlatform(platform: string): boolean {
    if (this.platforms.length === 0) return false;
    return this.compatibleWithPlatform(platform);
  }

  /** Whether installing requires system-level font placement (macOS CDN fonts). */
  requiresSystemInstallation(): boolean {
    return this.source() === 'apple_cdn' && this.platforms.includes('macos');
  }

  /** All fonts, with collection fonts rewritten to point at the collection
   * file — mirroring Ruby's `collection_fonts` normalization. */
  allFonts(): FontModel[] {
    const fonts = [...this.fonts];
    for (const collection of this.fontCollections) {
      for (const font of collection.fonts) {
        for (const style of font.styles) {
          style.font = collection.filename;
          style.sourceFont = collection.sourceFilename;
        }
        fonts.push(font);
      }
    }
    return fonts;
  }

  allStyles(): FontStyle[] {
    return this.allFonts().flatMap((font) => font.styles);
  }

  fontByName(name: string): FontModel | null {
    return this.allFonts().find((font) => equalsIgnoreCaseSafe(font.name, name)) ?? null;
  }

  fontsByName(name: string): FontModel[] {
    return this.allFonts().filter((font) => equalsIgnoreCaseSafe(font.name, name));
  }

  matchingResources(formatSpec: FormatSpec | null): Resource[] {
    if (formatSpec === null) return this.resources;
    return new FormatMatcher(formatSpec).filterResources(this.resources);
  }

  styleOverride(font: string): { override: string } | Record<string, never> {
    const style = this.allStyles().find((s) => s.familyName === font);
    return style?.override ? { override: style.override } : {};
  }
}

function equalsIgnoreCaseSafe(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/** Computes the formula key: the path relative to the Formulas root minus `.yml`. */
export function keyFromPath(formulaPath: string, formulasRoot: string): string {
  const normalized = formulaPath.replace(/\\/g, '/');
  const root = `${formulasRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  const relative = normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
  return relative.replace(/\.yml$/, '');
}

/** Ruby `titleize`: per path segment, underscores become spaces, words capitalized. */
export function titleize(key: string): string {
  return key
    .split('/')
    .map((part) =>
      part
        .split('_')
        .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
        .join(' '),
    )
    .join('/');
}

/** Holds multiple formulas (used by bulk loads). */
export class FormulaCollection {
  constructor(readonly formulas: Formula[]) {}
}
