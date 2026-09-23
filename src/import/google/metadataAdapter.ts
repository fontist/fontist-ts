import {
  AxisMetadata,
  FileMetadata,
  FontFileMetadata,
  Metadata,
  SourceMetadata,
} from './models/metadata.js';
import {
  type TextprotoMessage,
  fieldBoolean,
  fieldFloat,
  fieldInteger,
  fieldValue,
  findFields,
} from './textproto.js';

/** Adapts a parsed METADATA.pb textproto message into the Metadata domain
 * model (Ruby MetadataAdapter bridging unibuf messages to Models::Metadata). */
export class MetadataAdapter {
  static adapt(message: TextprotoMessage): Metadata {
    return Metadata.fromYamlObject(this.extractMetadata(message)) as Metadata;
  }

  private static extractMetadata(message: TextprotoMessage): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    const name = fieldValue(message, 'name');
    if (name !== null) out['name'] = name;
    const designer = fieldValue(message, 'designer');
    if (designer !== null) out['designer'] = designer;
    const license = fieldValue(message, 'license');
    if (license !== null) out['license'] = license;
    const category = fieldValue(message, 'category');
    if (category !== null) out['category'] = category;
    const dateAdded = fieldValue(message, 'date_added');
    if (dateAdded !== null) out['date_added'] = dateAdded;

    const fonts = this.extractFonts(message);
    if (fonts !== null) out['fonts'] = fonts;

    const subsets = findFields(message, 'subsets')
      .map((f) => f.value)
      .filter((v): v is string => v !== null);
    if (subsets.length > 0) out['subsets'] = subsets;

    const axes = this.extractAxes(message);
    if (axes !== null) out['axes'] = axes;

    const source = this.extractSource(message);
    if (source !== null) out['source'] = source;

    const overrides = this.extractRegistryOverrides(message);
    if (overrides !== null) out['registry_default_overrides'] = overrides;

    const isNoto = fieldBoolean(message, 'is_noto');
    if (isNoto !== null) out['is_noto'] = isNoto;

    const languages = findFields(message, 'languages')
      .map((f) => f.value)
      .filter((v): v is string => v !== null);
    if (languages.length > 0) out['languages'] = languages;

    const primaryScript = fieldValue(message, 'primary_script');
    if (primaryScript !== null) out['primary_script'] = primaryScript;

    return out;
  }

  private static extractFonts(message: TextprotoMessage): Array<Record<string, unknown>> | null {
    const fontFields = findFields(message, 'fonts');
    if (fontFields.length === 0) return null;
    const fonts: Array<Record<string, unknown>> = [];
    for (const field of fontFields) {
      if (!field.message) continue;
      const fontMessage = field.message;
      const font: Record<string, unknown> = {};
      const name = fieldValue(fontMessage, 'name');
      if (name !== null) font['name'] = name;
      const style = fieldValue(fontMessage, 'style');
      if (style !== null) font['style'] = style;
      const weight = fieldInteger(fontMessage, 'weight');
      if (weight !== null) font['weight'] = weight;
      const filename = fieldValue(fontMessage, 'filename');
      if (filename !== null) font['filename'] = filename;
      const postScriptName = fieldValue(fontMessage, 'post_script_name');
      if (postScriptName !== null) font['post_script_name'] = postScriptName;
      const fullName = fieldValue(fontMessage, 'full_name');
      if (fullName !== null) font['full_name'] = fullName;
      const copyright = fieldValue(fontMessage, 'copyright');
      if (copyright !== null) font['copyright'] = copyright;
      if (Object.keys(font).length > 0) fonts.push(font);
    }
    return fonts;
  }

  private static extractAxes(message: TextprotoMessage): Array<Record<string, unknown>> | null {
    const axisFields = findFields(message, 'axes');
    if (axisFields.length === 0) return null;
    const axes: Array<Record<string, unknown>> = [];
    for (const field of axisFields) {
      if (!field.message) continue;
      const axisMessage = field.message;
      const axis: Record<string, unknown> = {};
      const tag = fieldValue(axisMessage, 'tag');
      if (tag !== null) axis['tag'] = tag;
      const minValue = fieldFloat(axisMessage, 'min_value');
      if (minValue !== null) axis['min_value'] = minValue;
      const maxValue = fieldFloat(axisMessage, 'max_value');
      if (maxValue !== null) axis['max_value'] = maxValue;
      const defaultValue = fieldFloat(axisMessage, 'default_value');
      if (defaultValue !== null) axis['default_value'] = defaultValue;
      if (Object.keys(axis).length > 0) axes.push(axis);
    }
    return axes;
  }

  private static extractSource(message: TextprotoMessage): Record<string, unknown> | null {
    const sourceField = message.fields.find((f) => f.name === 'source' && f.message !== null);
    if (!sourceField?.message) return null;
    const sourceMessage = sourceField.message;
    const source: Record<string, unknown> = {};
    const keys = ['repository_url', 'commit', 'archive_url', 'branch', 'config_yaml'] as const;
    for (const key of keys) {
      const value = fieldValue(sourceMessage, key);
      if (value !== null) source[key] = value;
    }
    const fileFields = findFields(sourceMessage, 'files');
    if (fileFields.length > 0) {
      const files: Array<Record<string, unknown>> = [];
      for (const fileField of fileFields) {
        if (!fileField.message) continue;
        const file: Record<string, unknown> = {};
        const sourceFile = fieldValue(fileField.message, 'source_file');
        if (sourceFile !== null) file['source_file'] = sourceFile;
        const destFile = fieldValue(fileField.message, 'dest_file');
        if (destFile !== null) file['dest_file'] = destFile;
        if (Object.keys(file).length > 0) files.push(file);
      }
      if (files.length > 0) source['files'] = files;
    }
    return Object.keys(source).length > 0 ? source : null;
  }

  private static extractRegistryOverrides(message: TextprotoMessage): Record<string, number> | null {
    const overrideFields = findFields(message, 'registry_default_overrides');
    if (overrideFields.length === 0) return null;
    const overrides: Record<string, number> = {};
    for (const field of overrideFields) {
      if (!field.message) continue;
      const key = fieldValue(field.message, 'key');
      const value = fieldFloat(field.message, 'value');
      if (key !== null && value !== null) overrides[key] = value;
    }
    return Object.keys(overrides).length > 0 ? overrides : null;
  }
}

// The model classes are re-exported for adapter consumers.
export { AxisMetadata, FileMetadata, FontFileMetadata, Metadata, SourceMetadata };
