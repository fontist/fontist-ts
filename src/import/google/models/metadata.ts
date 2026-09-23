import type { ModelDefinition} from '../../../serialization/model.js';
import { SerializableModel } from '../../../serialization/model.js';

/** Variable font axis metadata from METADATA.pb (Ruby AxisMetadata). */
export class AxisMetadata extends SerializableModel {
  declare tag: string | null;
  declare minValue: number | null;
  declare maxValue: number | null;
  declare defaultValue: number | null;

  static override define(d: ModelDefinition) {
    d.attribute('tag', 'string');
    d.attribute('minValue', 'float');
    d.attribute('maxValue', 'float');
    d.attribute('defaultValue', 'float');
    d.mapping('tag');
    d.mapping('minValue');
    d.mapping('maxValue');
    d.mapping('defaultValue');
  }
}

/** Source file mapping metadata (Ruby FileMetadata). */
export class FileMetadata extends SerializableModel {
  declare sourceFile: string | null;
  declare destFile: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('sourceFile', 'string');
    d.attribute('destFile', 'string');
    d.mapping('sourceFile');
    d.mapping('destFile');
  }
}

/** Source repository metadata (Ruby SourceMetadata). */
export class SourceMetadata extends SerializableModel {
  declare repositoryUrl: string | null;
  declare commit: string | null;
  declare archiveUrl: string | null;
  declare branch: string | null;
  declare configYaml: string | null;
  declare files: FileMetadata[] | null;

  static override define(d: ModelDefinition) {
    d.attribute('repositoryUrl', 'string');
    d.attribute('commit', 'string');
    d.attribute('archiveUrl', 'string');
    d.attribute('branch', 'string');
    d.attribute('configYaml', 'string');
    d.attribute('files', FileMetadata, { collection: true });
    d.mapping('repositoryUrl');
    d.mapping('commit');
    d.mapping('archiveUrl');
    d.mapping('branch');
    d.mapping('configYaml');
    d.mapping('files');
  }
}

/** One font file entry from METADATA.pb (Ruby FontFileMetadata). */
export class FontFileMetadata extends SerializableModel {
  declare name: string | null;
  declare style: string | null;
  declare weight: number | null;
  declare filename: string | null;
  declare postScriptName: string | null;
  declare fullName: string | null;
  declare copyright: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('style', 'string');
    d.attribute('weight', 'integer');
    d.attribute('filename', 'string');
    d.attribute('postScriptName', 'string');
    d.attribute('fullName', 'string');
    d.attribute('copyright', 'string');
    d.mapping('name');
    d.mapping('style');
    d.mapping('weight');
    d.mapping('filename');
    d.mapping('postScriptName');
    d.mapping('fullName');
    d.mapping('copyright');
  }
}

/** Rich domain model for Google Fonts family metadata from METADATA.pb
 * (Ruby Google::Models::Metadata). */
export class Metadata extends SerializableModel {
  declare name: string | null;
  declare designer: string | null;
  declare license: string | null;
  declare category: string | null;
  declare dateAdded: string | null;
  declare fonts: FontFileMetadata[] | null;
  declare subsets: string[] | null;
  declare axes: AxisMetadata[] | null;
  declare languages: string[] | null;
  declare source: SourceMetadata | null;
  declare registryDefaultOverrides: Record<string, unknown> | null;
  declare isNoto: boolean | null;
  declare primaryScript: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('designer', 'string');
    d.attribute('license', 'string');
    d.attribute('category', 'string');
    d.attribute('dateAdded', 'string');
    d.attribute('fonts', FontFileMetadata, { collection: true });
    d.attribute('subsets', 'string', { collection: true });
    d.attribute('axes', AxisMetadata, { collection: true });
    d.attribute('languages', 'string', { collection: true });
    d.attribute('source', SourceMetadata);
    d.attribute('registryDefaultOverrides', 'hash');
    d.attribute('isNoto', 'boolean');
    d.attribute('primaryScript', 'string');

    d.mapping('name');
    d.mapping('designer');
    d.mapping('license');
    d.mapping('category');
    d.mapping('dateAdded');
    d.mapping('fonts');
    d.mapping('subsets');
    d.mapping('axes');
    d.mapping('languages');
    d.mapping('source');
    d.mapping('registryDefaultOverrides');
    d.mapping('isNoto');
    d.mapping('primaryScript');
  }

  // Validation

  validationErrors(): string[] {
    const errors: string[] = [];
    if (!this.name) errors.push('name is required');
    if (!this.designer) errors.push('designer is required');
    if (!this.license) errors.push('license is required');
    if (!this.category) errors.push('category is required');
    if (!this.dateAdded) errors.push('date_added is required');
    if ((this.fonts ?? []).length === 0) errors.push('at least one font file is required');
    if (!this.validLicense()) errors.push('invalid license type');
    if (!this.validCategory()) errors.push('invalid category');
    if (!this.validDateFormat()) errors.push('invalid date format');
    return errors;
  }

  validate(): true {
    const errors = this.validationErrors();
    if (errors.length > 0) throw new ValidationError(errors.join(', '));
    return true;
  }

  valid(): boolean {
    return this.validationErrors().length === 0;
  }

  // Classification

  variableFont(): boolean {
    return (this.axes ?? []).length > 0;
  }

  staticFont(): boolean {
    return !this.variableFont();
  }

  notoFont(): boolean {
    return this.isNoto === true || (this.name?.startsWith('Noto') ?? false);
  }

  complete(): boolean {
    return (
      this.source !== null &&
      (this.subsets ?? []).length > 0 &&
      (!this.variableFont() || this.axes !== null)
    );
  }

  minimal(): boolean {
    return (
      this.source === null &&
      (this.subsets ?? []).length === 0 &&
      (this.languages ?? []).length === 0
    );
  }

  // Properties

  filenames(): string[] {
    return (this.fonts ?? []).map((f) => f.filename ?? '');
  }

  axisTags(): string[] {
    return (this.axes ?? []).map((a) => a.tag ?? '');
  }

  fontCount(): number {
    return (this.fonts ?? []).length;
  }

  axisCount(): number {
    return (this.axes ?? []).length;
  }

  languageCount(): number {
    return (this.languages ?? []).length;
  }

  subsetCount(): number {
    return (this.subsets ?? []).length;
  }

  // License

  openLicense(): boolean {
    return ['OFL', 'APACHE'].includes(this.license ?? '');
  }

  requiresLicenseAgreement(): boolean {
    return !this.openLicense();
  }

  licenseName(): string {
    switch (this.license) {
      case 'OFL':
        return 'SIL Open Font License';
      case 'APACHE':
        return 'Apache License 2.0';
      case 'UFL':
        return 'Ubuntu Font License';
      default:
        return this.license ?? '';
    }
  }

  // Font file queries

  findFont(style: string, weight: number): FontFileMetadata | null {
    return (this.fonts ?? []).find((f) => f.style === style && f.weight === weight) ?? null;
  }

  regularFont(): FontFileMetadata | null {
    return this.findFont('normal', 400);
  }

  boldFont(): FontFileMetadata | null {
    return this.findFont('normal', 700);
  }

  italicFont(): FontFileMetadata | null {
    return this.findFont('italic', 400);
  }

  fontStyles(): string[] {
    return [...new Set((this.fonts ?? []).map((f) => f.style ?? ''))];
  }

  fontWeights(): number[] {
    return [...new Set((this.fonts ?? []).map((f) => f.weight ?? 0))].sort((a, b) => a - b);
  }

  hasItalics(): boolean {
    return (this.fonts ?? []).some((f) => f.style === 'italic');
  }

  // Variable font queries

  findAxis(tag: string): AxisMetadata | null {
    return (this.axes ?? []).find((a) => a.tag === tag) ?? null;
  }

  weightAxis(): AxisMetadata | null {
    return this.findAxis('wght');
  }

  widthAxis(): AxisMetadata | null {
    return this.findAxis('wdth');
  }

  slantAxis(): AxisMetadata | null {
    return this.findAxis('slnt');
  }

  variableWeight(): boolean {
    return this.weightAxis() !== null;
  }

  variableWidth(): boolean {
    return this.widthAxis() !== null;
  }

  variableSlant(): boolean {
    return this.slantAxis() !== null;
  }

  registryOverride(axisTag: string): number | null {
    const overrides = this.registryDefaultOverrides;
    if (!overrides) return null;
    const value = overrides[axisTag];
    return typeof value === 'number' ? value : null;
  }

  hasRegistryOverrides(): boolean {
    return this.registryDefaultOverrides !== null && Object.keys(this.registryDefaultOverrides).length > 0;
  }

  private validLicense(): boolean {
    if (this.license === null) return true;
    return ['OFL', 'APACHE', 'UFL'].includes(this.license);
  }

  private validCategory(): boolean {
    if (this.category === null) return true;
    return ['SANS_SERIF', 'SERIF', 'DISPLAY', 'HANDWRITING', 'MONOSPACE'].includes(this.category);
  }

  private validDateFormat(): boolean {
    if (this.dateAdded === null) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(this.dateAdded);
  }
}

export class ValidationError extends Error {}
