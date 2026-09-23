import type { ModelDefinition} from '../../../serialization/model.js';
import { SerializableModel } from '../../../serialization/model.js';
import { Axis } from './axis.js';

/** One font family from the Google Fonts API (Ruby
 * Google::Models::FontFamily). The `files` payload is a variant→URL map. */
export class FontFamily extends SerializableModel {
  declare family: string | null;
  declare variants: string[] | null;
  declare subsets: string[] | null;
  declare version: string | null;
  declare lastModified: string | null;
  declare filesData: Record<string, string> | string | null;
  declare category: string | null;
  declare kind: string | null;
  declare menu: string | null;
  declare axes: Axis[] | null;

  // GitHub-source-only fields
  declare designer: string | null;
  declare license: string | null;
  declare licenseText: string | null;
  declare description: string | null;
  declare homepage: string | null;
  declare fontFileData: unknown;

  static override define(d: ModelDefinition) {
    d.attribute('family', 'string');
    d.attribute('variants', 'string', { collection: true });
    d.attribute('subsets', 'string', { collection: true });
    d.attribute('version', 'string');
    d.attribute('lastModified', 'string');
    d.attribute('filesData', 'hash');
    d.attribute('category', 'string');
    d.attribute('kind', 'string');
    d.attribute('menu', 'string');
    d.attribute('axes', Axis, { collection: true });
    d.attribute('designer', 'string');
    d.attribute('license', 'string');
    d.attribute('licenseText', 'string');
    d.attribute('description', 'string');
    d.attribute('homepage', 'string');
    d.attribute('fontFileData', 'hash');

    d.mapping('family');
    d.mapping('variants');
    d.mapping('subsets');
    d.mapping('version');
    d.mapping('lastModified', { to: 'lastModified' });
    d.mapping('filesData', { to: 'files' });
    d.mapping('category');
    d.mapping('kind');
    d.mapping('menu');
    d.mapping('axes');
    d.mapping('designer');
    d.mapping('license');
    d.mapping('licenseText');
    d.mapping('description');
    d.mapping('homepage');
    d.mapping('fontFileData');
  }

  /** Variant→URL map, tolerating object or JSON/`=>` string payloads. */
  files(): Record<string, string> {
    const data = this.filesData;
    if (data === null || data === undefined) return {};
    if (typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, string>;
    }
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as Record<string, string>;
      } catch {
        try {
          return JSON.parse(data.replaceAll('=>', ':')) as Record<string, string>;
        } catch {
          return {};
        }
      }
    }
    return {};
  }

  setFiles(value: Record<string, string> | string | null): void {
    this.filesData = value;
  }

  variableFont(): boolean {
    return (this.axes ?? []).length > 0;
  }

  variantsByFormat(format: 'ttf' | 'woff2'): Record<string, string> {
    const extension = format === 'ttf' ? '.ttf' : '.woff2';
    const files = this.files();
    const out: Record<string, string> = {};
    for (const [variant, url] of Object.entries(files)) {
      if (url.endsWith(extension)) out[variant] = url;
    }
    return out;
  }

  axisByTag(tag: string): Axis | null {
    if (!this.variableFont()) return null;
    return (this.axes ?? []).find((axis) => axis.tag === tag) ?? null;
  }

  weightAxes(): Axis[] {
    return this.variableFont() ? (this.axes ?? []).filter((a) => a.weightAxis()) : [];
  }

  widthAxes(): Axis[] {
    return this.variableFont() ? (this.axes ?? []).filter((a) => a.widthAxis()) : [];
  }

  slantAxes(): Axis[] {
    return this.variableFont() ? (this.axes ?? []).filter((a) => a.slantAxis()) : [];
  }

  customAxes(): Axis[] {
    return this.variableFont() ? (this.axes ?? []).filter((a) => a.customAxis()) : [];
  }

  axesCount(): number {
    return this.variableFont() ? (this.axes ?? []).length : 0;
  }

  variantNames(): string[] {
    return this.variants ?? [];
  }

  fileUrls(): string[] {
    return Object.values(this.files());
  }

  variantExists(variantName: string): boolean {
    return this.variantNames().includes(variantName);
  }

  variantUrl(variantName: string): string | null {
    const files = this.files();
    return Object.keys(files).length === 0 ? null : files[variantName] ?? null;
  }

  summary(): string {
    const parts = [this.family ?? '', this.version ?? ''];
    if (this.variableFont()) parts.push(`(${this.axesCount()} axes)`);
    return parts.join(' ');
  }
}
