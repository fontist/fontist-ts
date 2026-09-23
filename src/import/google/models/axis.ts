import type { ModelDefinition} from '../../../serialization/model.js';
import { SerializableModel } from '../../../serialization/model.js';

const STANDARD_TAGS: Record<string, string> = {
  wght: 'weight',
  wdth: 'width',
  slnt: 'slant',
  ital: 'italic',
  opsz: 'optical_size',
};

/** One variable-font axis from the Google Fonts API (Ruby
 * Google::Models::Axis). */
export class Axis extends SerializableModel {
  declare tag: string | null;
  declare start: number | null;
  declare end: number | null;

  static override define(d: ModelDefinition) {
    d.attribute('tag', 'string');
    d.attribute('start', 'float');
    d.attribute('end', 'float');
    d.mapping('tag');
    d.mapping('start');
    d.mapping('end', { to: 'end' });
  }

  weightAxis(): boolean {
    return this.tag === 'wght';
  }

  widthAxis(): boolean {
    return this.tag === 'wdth';
  }

  slantAxis(): boolean {
    return this.tag === 'slnt';
  }

  customAxis(): boolean {
    return this.tag === null || !Object.prototype.hasOwnProperty.call(STANDARD_TAGS, this.tag);
  }

  range(): Array<number | null> {
    return [this.start, this.end];
  }

  description(): string {
    const type = (this.tag && STANDARD_TAGS[this.tag]) || 'custom';
    return `${this.tag} (${type}): ${formatValue(this.start)}–${formatValue(this.end)}`;
  }
}

function formatValue(value: number | null): string {
  if (value === null) return 'null';
  return value === Math.trunc(value) ? String(Math.trunc(value)) : String(value);
}
