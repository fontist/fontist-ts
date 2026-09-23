import type { ModelDefinition} from '../../serialization/model.js';
import { SerializableModel } from '../../serialization/model.js';

/** Metadata extracted from a single font face (Ruby
 * Fontist::Import::Models::FontMetadata). */
export class FontMetadata extends SerializableModel {
  declare familyName: string | null;
  declare subfamilyName: string | null;
  declare fullName: string | null;
  declare postscriptName: string | null;
  declare preferredFamilyName: string | null;
  declare preferredSubfamilyName: string | null;
  declare version: string | null;
  declare copyright: string | null;
  declare description: string | null;
  declare vendorUrl: string | null;
  declare licenseUrl: string | null;
  declare fontFormat: string | null;
  declare isVariable: boolean;

  static override define(d: ModelDefinition) {
    d.attribute('familyName', 'string');
    d.attribute('subfamilyName', 'string');
    d.attribute('fullName', 'string');
    d.attribute('postscriptName', 'string');
    d.attribute('preferredFamilyName', 'string');
    d.attribute('preferredSubfamilyName', 'string');
    d.attribute('version', 'string');
    d.attribute('copyright', 'string');
    d.attribute('description', 'string');
    d.attribute('vendorUrl', 'string');
    d.attribute('licenseUrl', 'string');
    d.attribute('fontFormat', 'string');
    d.attribute('isVariable', 'boolean');

    d.mapping('familyName');
    d.mapping('subfamilyName');
    d.mapping('fullName');
    d.mapping('postscriptName');
    d.mapping('preferredFamilyName');
    d.mapping('preferredSubfamilyName');
    d.mapping('version');
    d.mapping('copyright');
    d.mapping('description');
    d.mapping('vendorUrl');
    d.mapping('licenseUrl');
    d.mapping('fontFormat');
    d.mapping('isVariable');
  }
}
