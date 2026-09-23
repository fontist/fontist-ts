import type { ModelDefinition} from '../../../serialization/model.js';
import { SerializableModel } from '../../../serialization/model.js';

const VALID_FORMATS = ['ttf', 'woff2'];

/** One downloadable font variant (Ruby Google::Models::FontVariant). */
export class FontVariant extends SerializableModel {
  declare name: string | null;
  declare url: string | null;
  declare format: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('url', 'string');
    d.attribute('format', 'string');
    d.mapping('name');
    d.mapping('url');
    d.mapping('format');
  }

  extension(): string {
    switch (this.format) {
      case 'ttf':
        return '.ttf';
      case 'woff2':
        return '.woff2';
      default:
        return '';
    }
  }

  ttf(): boolean {
    return this.format === 'ttf';
  }

  woff2(): boolean {
    return this.format === 'woff2';
  }

  description(): string {
    return `${this.name} (${this.format})`;
  }

  validFormat(): boolean {
    return VALID_FORMATS.includes(this.format ?? '');
  }
}
