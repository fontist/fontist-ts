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

  /** Whether re-importing now would produce a different formula. */
  isOutdated(_other: ImportSource): boolean {
    return false;
  }

  differentiationKey(): string | null {
    return null;
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

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof MacosImportSource)) return true;
    const otherVersion = other.frameworkVersion ?? 0;
    const version = this.frameworkVersion ?? 0;
    if (otherVersion !== version) return otherVersion > version;
    return (other.postedDate ?? '') > (this.postedDate ?? '');
  }

  override differentiationKey(): string | null {
    return this.assetId;
  }

  compatibleWithMacos(macosVersion: number): boolean {
    const version = this.frameworkVersion ?? 0;
    return version === 0 || macosVersion >= version;
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

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof GoogleImportSource)) return true;
    return (other.commitId ?? '') !== (this.commitId ?? '');
  }

  override differentiationKey(): string | null {
    return this.familyId;
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

  override isOutdated(other: ImportSource): boolean {
    if (!(other instanceof SilImportSource)) return true;
    return (other.version ?? '') !== (this.version ?? '');
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
}

/** Registry driving polymorphic `import_source` (de)serialization. */
export const IMPORT_SOURCE_REGISTRY = {
  macos: MacosImportSource,
  google: GoogleImportSource,
  sil: SilImportSource,
  windows: WindowsImportSource,
} as const;
