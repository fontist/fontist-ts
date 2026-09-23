import {
  macosFrameworkCompatibleWith,
  macosFrameworkDescription,
  macosFrameworkMaxVersion,
  macosFrameworkMinVersion,
  macosFrameworkParserClass,
} from '../import/macos/frameworkMetadata.js';
import { type ModelDefinition, SerializableModel } from '../serialization/model.js';


export class ImportSource extends SerializableModel {
  declare type: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('type', 'string');
    d.mapping('type');
  }

  override yamlTag(): string | null {
    return this.type;
  }

  /** Unique key differentiating this source from others (Ruby: abstract). */
  differentiationKey(): string | null {
    throw new Error(`${this.constructor.name} must implement #differentiation_key`);
  }

  /** Whether re-importing now would produce a different formula (Ruby: abstract). */
  isOutdated(_other: ImportSource): boolean {
    throw new Error(`${this.constructor.name} must implement #outdated?`);
  }
}

export class MacosImportSource extends ImportSource {
  declare frameworkVersion: number | null;
  declare postedDate: string | null;
  declare assetId: string | null;

  static override define(d: ModelDefinition) {
    super.define(d);
    d.attribute('frameworkVersion', 'integer');
    d.attribute('postedDate', 'string');
    d.attribute('assetId', 'string');
    d.mapping('frameworkVersion');
    d.mapping('postedDate');
    d.mapping('assetId');
  }

  override differentiationKey(): string | null {
    return this.assetId?.toLowerCase() ?? null;
  }

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof MacosImportSource)) return false;
    if (!this.postedDate || !other.postedDate) return false;
    try {
      return Date.parse(this.postedDate) < Date.parse(other.postedDate);
    } catch {
      return false;
    }
  }

  override equals(other: ImportSource): boolean {
    if (!(other instanceof MacosImportSource)) return false;
    return (
      this.frameworkVersion === other.frameworkVersion &&
      (this.assetId?.toLowerCase() ?? null) === (other.assetId?.toLowerCase() ?? null)
    );
  }

  minMacosVersion(): string | null {
    return macosFrameworkMinVersion(this.frameworkVersion);
  }

  maxMacosVersion(): string | null {
    return macosFrameworkMaxVersion(this.frameworkVersion);
  }

  compatibleWithMacos(macosVersion: string): boolean {
    return macosFrameworkCompatibleWith(this.frameworkVersion, macosVersion);
  }

  parserClassName(): string | null {
    return macosFrameworkParserClass(this.frameworkVersion);
  }

  frameworkDescription(): string | null {
    return macosFrameworkDescription(this.frameworkVersion);
  }
}

export class GoogleImportSource extends ImportSource {
  declare commitId: string | null;
  declare apiVersion: string | null;
  declare lastModified: string | null;
  declare familyId: string | null;

  static override define(d: ModelDefinition) {
    super.define(d);
    d.attribute('commitId', 'string');
    d.attribute('apiVersion', 'string');
    d.attribute('lastModified', 'string');
    d.attribute('familyId', 'string');
    d.mapping('commitId');
    d.mapping('apiVersion');
    d.mapping('lastModified');
    d.mapping('familyId');
  }

  /** Google Fonts is a live service; formulas always use simple filenames. */
  override differentiationKey(): string | null {
    return null;
  }

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof GoogleImportSource)) return false;
    if (!this.commitId || !other.commitId) return false;
    return this.commitId !== other.commitId;
  }

  override equals(other: ImportSource): boolean {
    return other instanceof GoogleImportSource && this.commitId === other.commitId;
  }
}

export class SilImportSource extends ImportSource {
  declare version: string | null;
  declare releaseDate: string | null;

  static override define(d: ModelDefinition) {
    super.define(d);
    d.attribute('version', 'string');
    d.attribute('releaseDate', 'string');
    d.mapping('version');
    d.mapping('releaseDate');
  }

  override differentiationKey(): string | null {
    return this.version;
  }

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof SilImportSource)) return false;
    if (!this.version || !other.version) return false;
    return this.version < other.version;
  }

  override equals(other: ImportSource): boolean {
    return other instanceof SilImportSource && this.version === other.version;
  }
}

export class WindowsImportSource extends ImportSource {
  declare capabilityName: string | null;
  declare minWindowsVersion: string | null;

  static override define(d: ModelDefinition) {
    super.define(d);
    d.attribute('capabilityName', 'string');
    d.attribute('minWindowsVersion', 'string');
    d.mapping('capabilityName');
    d.mapping('minWindowsVersion');
  }

  override differentiationKey(): string | null {
    return this.capabilityName;
  }

  /** FOD capabilities are either present or not — never outdated. */
  override isOutdated(_other: ImportSource): boolean {
    return false;
  }

  override equals(other: ImportSource): boolean {
    return (
      other instanceof WindowsImportSource && this.capabilityName === other.capabilityName
    );
  }
}

/** Registry driving polymorphic `import_source` (de)serialization. */
export const IMPORT_SOURCE_REGISTRY = {
  macos: MacosImportSource,
  google: GoogleImportSource,
  sil: SilImportSource,
  windows: WindowsImportSource,
} as const;
