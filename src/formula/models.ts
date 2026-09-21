import { type ModelDefinition, SerializableModel } from '../serialization/model.js';
import type { FormatMatcher } from './formatMatcher.js';

export class FontStyle extends SerializableModel {
  declare familyName: string | null;
  declare type: string | null;
  declare preferredFamilyName: string | null;
  declare preferredType: string | null;
  declare defaultFamilyName: string | null;
  declare defaultType: string | null;
  declare fullName: string | null;
  declare postScriptName: string | null;
  declare version: string | null;
  declare description: string | null;
  declare copyright: string | null;
  declare font: string | null;
  declare sourceFont: string | null;
  declare override: string | null;
  declare formats: string[];
  declare variableFont: boolean | null;
  declare variableAxes: string[];
  declare sourceResource: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('familyName', 'string');
    d.attribute('type', 'string');
    d.attribute('preferredFamilyName', 'string');
    d.attribute('preferredType', 'string');
    d.attribute('defaultFamilyName', 'string');
    d.attribute('defaultType', 'string');
    d.attribute('fullName', 'string');
    d.attribute('postScriptName', 'string');
    d.attribute('version', 'string');
    d.attribute('description', 'string');
    d.attribute('copyright', 'string');
    d.attribute('font', 'string');
    d.attribute('sourceFont', 'string');
    d.attribute('override', 'string');
    d.attribute('formats', 'string', { collection: true, default: () => [] });
    d.attribute('variableFont', 'boolean');
    d.attribute('variableAxes', 'string', { collection: true, default: () => [] });
    d.attribute('sourceResource', 'string');

    d.mapping('familyName');
    d.mapping('type');
    d.mapping('preferredFamilyName');
    d.mapping('preferredType');
    d.mapping('defaultFamilyName');
    d.mapping('defaultType');
    d.mapping('fullName');
    d.mapping('postScriptName');
    d.mapping('version');
    d.mapping('description');
    d.mapping('copyright');
    d.mapping('font');
    d.mapping('sourceFont');
    d.mapping('override');
    d.mapping('formats');
    d.mapping('variableFont');
    d.mapping('variableAxes');
    d.mapping('sourceResource');
  }

  isVariableFont(): boolean {
    return this.variableFont === true;
  }
}

export class FontModel extends SerializableModel {
  declare name: string | null;
  declare styles: FontStyle[];

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('styles', FontStyle, { collection: true, default: () => [] });
    d.mapping('name');
    d.mapping('styles');
  }
}

export class FontCollection extends SerializableModel {
  declare filename: string | null;
  declare sourceFilename: string | null;
  declare fonts: FontModel[];

  static override define(d: ModelDefinition) {
    d.attribute('filename', 'string');
    d.attribute('sourceFilename', 'string');
    d.attribute('fonts', FontModel, { collection: true, default: () => [] });
    d.mapping('filename');
    d.mapping('sourceFilename');
    d.mapping('fonts');
  }
}

export class ExtractOptions extends SerializableModel {
  declare file: string | null;
  declare fontsSubDir: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('file', 'string');
    d.attribute('fontsSubDir', 'string');
    d.mapping('file');
    d.mapping('fontsSubDir', { to: 'fonts_sub_dir' });
  }
}

export class Extract extends SerializableModel {
  declare format: string | null;
  declare file: string | null;
  declare options: ExtractOptions[];

  static override define(d: ModelDefinition) {
    d.attribute('format', 'string');
    d.attribute('file', 'string');
    d.attribute('options', ExtractOptions, { collection: true, default: () => [] });
    d.mapping('format');
    d.mapping('file');
    d.mapping('options');
  }
}

export type ResourceFormat = 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc' | 'otc' | string;

export class Resource extends SerializableModel {
  declare name: string | null;
  declare source: string | null;
  declare urls: string[];
  declare sha256: string[];
  declare fileSize: number | null;
  declare family: string | null;
  declare files: string[];
  declare format: ResourceFormat | null;
  declare variableAxes: string[];
  declare capabilityName: string | null;

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('source', 'string');
    d.attribute('urls', 'string', { collection: true, default: () => [] });
    d.attribute('sha256', 'string', { collection: true, default: () => [] });
    d.attribute('fileSize', 'integer');
    d.attribute('family', 'string');
    d.attribute('files', 'string', { collection: true, default: () => [] });
    d.attribute('format', 'string');
    d.attribute('variableAxes', 'string', { collection: true, default: () => [] });
    d.attribute('capabilityName', 'string');

    d.mapping('name');
    d.mapping('source');
    d.mapping('urls');
    d.mapping('sha256');
    d.mapping('fileSize');
    d.mapping('family');
    d.mapping('files');
    d.mapping('format');
    d.mapping('variableAxes');
    d.mapping('capabilityName');
  }

  isVariableFont(): boolean {
    return this.variableAxes.length > 0;
  }

  isCollectionFile(): boolean {
    return this.format === 'ttc' || this.format === 'otc';
  }

  isEmpty(): boolean {
    return this.urls.length === 0 && this.files.length === 0;
  }

  /** Whether any of the requested axes are covered by this resource. */
  axesSubsetOf(requestedAxes: string[]): boolean {
    return requestedAxes.every((axis) => this.variableAxes.includes(axis));
  }

  matchesFormatMatcher(matcher: FormatMatcher): boolean {
    return matcher.matchesResource(this);
  }
}
