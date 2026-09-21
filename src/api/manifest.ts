import * as yaml from 'yaml';
import type { FontistContext } from '../context.js';
import {
  ManifestCouldNotBeFoundError,
  ManifestCouldNotBeReadError,
  MissingFontError,
  PlatformMismatchError,
} from '../errors/errors.js';
import { type ModelDefinition, SerializableModel } from '../serialization/model.js';
import { FormatSpec } from '../formula/formatSpec.js';
import type { FormatMatcher } from '../formula/formatMatcher.js';
import { Font, type FontOptions } from './font.js';
import { SystemFont, type FoundStyle } from '../system/systemFont.js';
import { FormulaRepository } from '../formula/formulaRepository.js';

/** One manifest entry: a font name plus optional style list and format hints. */
export class ManifestFont extends SerializableModel {
  declare name: string | null;
  declare styles: string[];
  declare format: string | null;
  declare variableAxes: string[];
  declare preferVariable: boolean | null;
  declare transcodePath: string | null;
  declare keepOriginal: boolean | null;
  declare collectionIndex: number | null;

  static override define(d: ModelDefinition) {
    d.attribute('name', 'string');
    d.attribute('styles', 'string', { collection: true, default: () => [] });
    d.attribute('format', 'string');
    d.attribute('variableAxes', 'string', { collection: true, default: () => [] });
    d.attribute('preferVariable', 'boolean');
    d.attribute('transcodePath', 'string');
    d.attribute('keepOriginal', 'boolean');
    d.attribute('collectionIndex', 'integer');

    d.mapping('name');
    d.mapping('styles');
    d.mapping('format');
    d.mapping('variableAxes', { to: 'variable_axes' });
    d.mapping('preferVariable', { to: 'prefer_variable' });
    d.mapping('transcodePath', { to: 'transcode_path' });
    d.mapping('keepOriginal', { to: 'keep_original' });
    d.mapping('collectionIndex', { to: 'collection_index' });
  }

  formatSpec(): FormatSpec {
    return new FormatSpec({
      format: this.format,
      variableAxes: this.variableAxes,
      preferVariable: this.preferVariable ?? false,
      transcodePath: this.transcodePath,
      keepOriginal: this.keepOriginal ?? true,
      collectionIndex: this.collectionIndex,
    });
  }
}

export interface ManifestResponseStyle {
  type: string;
  fullName: string;
  paths: string[];
}

export interface ManifestResponseFont {
  name: string;
  styles: ManifestResponseStyle[];
}

export interface ManifestLocateOptions {
  /** When true, missing fonts raise MissingFontError. */
  locations?: boolean;
  formatMatcher?: FormatMatcher | null;
}

/** A manifest of font requirements, loadable from YAML:
 * `{ "Crimson Text": { styles: [Regular, Italic] }, ... }`. */
export class Manifest {
  readonly fonts: ManifestFont[];

  constructor(fonts: ManifestFont[] = []) {
    this.fonts = fonts;
  }

  static fromObject(data: unknown): Manifest {
    const manifest = new Manifest();
    if (typeof data !== 'object' || data === null) return manifest;
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const fields = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
      manifest.fonts.push(new ManifestFont({ ...fields, name: key }));
    }
    return manifest;
  }

  static fromYaml(text: string): Manifest {
    return Manifest.fromObject(yaml.parse(text));
  }

  static async fromFile(filePath: string): Promise<Manifest> {
    let text: string;
    try {
      text = await import('node:fs/promises').then((m) => m.readFile(filePath, 'utf8'));
    } catch {
      throw new ManifestCouldNotBeFoundError(`Manifest file not found: ${filePath}`);
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new ManifestCouldNotBeReadError(`Manifest file is empty: ${filePath}`);
    }
    try {
      return Manifest.fromYaml(trimmed);
    } catch (err) {
      if (err instanceof ManifestCouldNotBeReadError) throw err;
      throw new ManifestCouldNotBeReadError(`Manifest file could not be parsed: ${filePath} (${String(err)})`);
    }
  }

  toObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const font of this.fonts) {
      const obj = font.toYamlObject();
      const name = obj.name;
      delete obj.name;
      result[String(name)] = obj;
    }
    return result;
  }

  /** Locates each requested font/style in the installed scopes. */
  async locate(ctx: FontistContext, options: ManifestLocateOptions = {}): Promise<ManifestResponseFont[]> {
    const systemFont = new SystemFont(ctx);
    const response: ManifestResponseFont[] = [];
    for (const font of this.fonts) {
      const styles = font.styles.length > 0 ? font.styles : [null];
      const matcher = options.formatMatcher ?? null;
      const groups = new Map<string, ManifestResponseStyle>();
      for (const style of styles) {
        let found: FoundStyle[];
        try {
          found = await systemFont.findStyles(font.name ?? '', style, matcher);
        } catch {
          found = [];
        }
        if (found.length === 0 && options.locations) {
          throw new MissingFontError(font.name ?? '', style);
        }
        for (const entry of found) {
          const type = entry.subfamily ?? style ?? '';
          const group = groups.get(type) ?? { type, fullName: entry.fullName ?? '', paths: [] };
          if (entry.path) group.paths.push(entry.path);
          if (group.fullName === '' && entry.fullName) group.fullName = entry.fullName;
          groups.set(type, group);
        }
      }
      response.push({
        name: font.name ?? '',
        styles: Array.from(groups.values()).map((group) => ({
          type: group.type,
          fullName: group.fullName,
          paths: group.paths,
        })),
      });
    }
    return response;
  }

  /** Installs every font in the manifest (force reinstall), then locates. */
  async install(
    ctx: FontistContext,
    options: Omit<FontOptions, 'formatSpec' | 'force'> = {},
  ): Promise<ManifestResponseFont[]> {
    await this.validatePlatformCompatibility(ctx);
    for (const font of this.fonts) {
      await Font.install(font.name ?? '', ctx, {
        ...options,
        force: true,
        formatSpec: font.formatSpec(),
      });
    }
    return this.locate(ctx, { locations: true });
  }

  private async validatePlatformCompatibility(ctx: FontistContext): Promise<void> {
    const repository = new FormulaRepository(ctx);
    for (const font of this.fonts) {
      const formulas = await repository.findFormulasForFont(font.name ?? '');
      if (formulas.length === 0) continue;
      if (!formulas.some((formula) => formula.compatibleWithPlatform(ctx.platform))) {
        throw new PlatformMismatchError(
          font.name ?? '',
          Array.from(new Set(formulas.flatMap((formula) => formula.platforms))),
          ctx.platform,
        );
      }
    }
  }
}
