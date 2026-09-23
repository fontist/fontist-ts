import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type { UI } from '../ui/ui.js';
import type { ImportSource } from '../formula/importSources.js';
import { TextHelper } from './helpers/textHelper.js';
import { stringifyKeys } from './helpers/hashHelper.js';
import { type CollectionFile } from './files/collectionFile.js';
import type { ImportFontFile } from './otf/fontFile.js';
import { type FontParsingErrorCollector } from './fontParsingErrorCollector.js';
import { type ExtractionOperations } from './recursiveExtraction.js';
import { SUPPORTED_FONT_EXTENSIONS } from './recursiveExtraction.js';
import { FontNotFoundError } from '../errors/errors.js';

/** Attribute order of generated formulas (Ruby FormulaBuilder::FORMULA_ATTRIBUTES). */
export const FORMULA_ATTRIBUTES = [
  'schema_version',
  'name',
  'platforms',
  'description',
  'homepage',
  'resources',
  'font_collections',
  'fonts',
  'extract',
  'copyright',
  'license_url',
  'requires_license_agreement',
  'open_license',
  'digest',
  'command',
  'import_source',
  'font_version',
] as const;

export interface FormulaBuilderOptions {
  name?: string;
  platforms?: string[];
  homepage?: string;
  schemaVersion?: number;
  /** Boolean flag or the license text itself (macOS formulas embed the text). */
  requiresLicenseAgreement?: boolean | string | null;
  openLicense?: boolean;
  digest?: string;
  formulaDir?: string;
  keepExisting?: boolean;
  importSource?: ImportSource | null;
}

/** Builds a formula YAML file from extracted font files (Ruby FormulaBuilder). */
export class FormulaBuilder {
  options: FormulaBuilderOptions = {};
  resources: Record<string, unknown> | null = null;
  fontFiles: ImportFontFile[] = [];
  fontCollectionFiles: CollectionFile[] = [];
  licenseText: string | null = null;
  operations: ExtractionOperations = {};
  fontVersion: string | null = null;
  importSource: ImportSource | null = null;
  errorCollector: FontParsingErrorCollector | null = null;

  constructor(options: {
    ui?: UI;
    argv?: string[];
  } = {}) {
    this.ui = options.ui ?? null;
    this.argv = options.argv ?? process.argv.slice(2);
  }

  private readonly ui: UI | null;
  private readonly argv: string[];
  private cachedName: string | null = null;

  formula(): Record<string, unknown> {
    const values: Record<string, unknown> = {
      schema_version: this.schemaVersion(),
      name: this.name(),
      platforms: this.options.platforms ?? null,
      description: this.description(),
      homepage: this.homepage(),
      resources: this.resources,
      font_collections: this.fontCollections(),
      fonts: this.fonts(),
      extract: this.extract(),
      copyright: this.copyright(),
      license_url: this.licenseUrl(),
      requires_license_agreement: this.options.requiresLicenseAgreement ?? null,
      open_license: this.openLicense(),
      digest: this.options.digest ?? null,
      command: this.command(),
      import_source: this.importSource ? this.importSource.toYamlObject() : null,
      font_version: this.fontVersion,
    };
    return compactKeys(FORMULA_ATTRIBUTES, values);
  }

  save(): string {
    const filePath = this.pathFromName();
    if (this.options.keepExisting && fsSync.existsSync(filePath)) {
      return filePath;
    }
    const dumped = yaml.stringify(stringifyKeys(this.formula()), { lineWidth: 0 });
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    fsSync.writeFileSync(filePath, dumped);
    return filePath;
  }

  schemaVersion(): number {
    return this.options.schemaVersion ?? 4;
  }

  name(): string {
    if (this.cachedName !== null) return this.cachedName;
    if (this.options.name) {
      this.cachedName = this.options.name;
      return this.cachedName;
    }
    const common = this.commonPrefix();
    this.cachedName = common || this.bothFonts()[0]!.familyName;
    return this.cachedName;
  }

  private commonPrefix(): string | null {
    const familyPrefix = this.commonPrefixByAttr('familyName');
    const stylePrefix = this.commonPrefixByAttr('type');
    return [familyPrefix, stylePrefix].filter((p) => p !== null).join(' ') || null;
  }

  private commonPrefixByAttr(attr: 'familyName' | 'type'): string | null {
    const names = uniq(this.bothFonts().map((font) => font[attr]));
    const prefix = TextHelper.longestCommonPrefix(names);
    return prefix === 'Regular' ? null : prefix;
  }

  private bothFonts(): ImportFontFile[] {
    const files = [...this.fontFiles, ...this.fontCollectionFiles.flatMap((c) => c.fonts)];
    if (files.length === 0) {
      const parsingErrors = this.errorCollector?.errors ?? [];
      const extensions = SUPPORTED_FONT_EXTENSIONS.join(', ');
      throw new FontNotFoundError(
        `No fonts found in archive. Only files with these extensions are processed: ${extensions}`,
        parsingErrors.map((e) => `${e.path}: ${e.message}`),
      );
    }
    return files;
  }

  description(): string {
    return this.name();
  }

  homepage(): string | null {
    return this.options.homepage ?? this.bothFonts().map((f) => f.homepage).find((h) => h) ?? null;
  }

  fontCollections(): Array<Record<string, unknown>> | null {
    if (this.fontCollectionFiles.length === 0) return null;
    const collections = this.fontCollectionFiles.map((file) => {
      const entry: Record<string, unknown> = {
        filename: file.filename,
        source_filename: file.sourceFilename,
        fonts: fontsFromFiles(file.fonts, true),
      };
      return compactObject(entry);
    });
    return collections.sort((a, b) => String(a['filename']).localeCompare(String(b['filename'])));
  }

  fonts(): Array<Record<string, unknown>> | null {
    if (this.fontFiles.length === 0) return null;
    return fontsFromFiles(this.fontFiles, false);
  }

  extract(): ExtractionOperations {
    return this.operations ?? {};
  }

  copyright(): string | null {
    return this.bothFonts().map((f) => f.copyright).find((c) => c) ?? null;
  }

  licenseUrl(): string | null {
    return this.bothFonts().map((f) => f.licenseUrl).find((l) => l) ?? null;
  }

  openLicense(): string | null {
    if (!this.licenseText && !this.options.requiresLicenseAgreement) {
      this.ui?.error('WARN: please add license manually');
    }
    if (!this.licenseText) return null;
    if (!this.options.openLicense) {
      this.ui?.error(
        "WARN: ensure it's an open license, otherwise change the 'open_license' attribute to 'requires_license_agreement'",
      );
    }
    return TextHelper.cleanup(this.licenseText);
  }

  command(): string {
    return shellJoin(this.argv);
  }

  private pathFromName(): string {
    const filename = this.generateFilename();
    return this.options.formulaDir ? path.join(this.options.formulaDir, filename) : filename;
  }

  /** Versioned filenames for sources with differentiation keys
   * (e.g. SIL with versions): `name_version.yml`, else `name.yml`. */
  generateFilename(): string {
    const baseName = normalizeFilename(this.name());
    let key: string | null = null;
    try {
      key = this.importSource?.differentiationKey() ?? null;
    } catch {
      key = null;
    }
    return key ? `${baseName}_${key}.yml` : `${baseName}.yml`;
  }
}

/** Ruby ManualFormulaBuilder — attribute-order variant for manual formulas:
 * drops resources/open_license/license_url/copyright and adds instructions
 * after homepage. */
export class ManualFormulaBuilder extends FormulaBuilder {
  instructions: string | null = null;

  override formula(): Record<string, unknown> {
    const values: Record<string, unknown> = {
      schema_version: this.schemaVersion(),
      name: this.name(),
      description: this.description(),
      homepage: this.homepage(),
      platforms: this.options.platforms ?? null,
      instructions: this.instructions,
      font_collections: this.fontCollections(),
      fonts: this.fonts(),
      extract: this.extract(),
      requires_license_agreement: this.options.requiresLicenseAgreement ?? null,
      digest: this.options.digest ?? null,
      command: this.command(),
      import_source: this.importSource ? this.importSource.toYamlObject() : null,
      font_version: this.fontVersion,
    };
    const order = [
      'schema_version',
      'name',
      'description',
      'homepage',
      'platforms',
      'instructions',
      'font_collections',
      'fonts',
      'extract',
      'requires_license_agreement',
      'digest',
      'command',
      'import_source',
      'font_version',
    ];
    return compactKeys(order, values);
  }
}

function fontsFromFiles(files: ImportFontFile[], collectionStyle: boolean): Array<Record<string, unknown>> {
  const groups = new Map<string, ImportFontFile[]>();
  for (const file of files) {
    const list = groups.get(file.familyName) ?? [];
    list.push(file);
    groups.set(file.familyName, list);
  }
  const fonts = [...groups.entries()].map(([name, group]) => ({
    name,
    styles: group
      .map((file) => deepCompact(collectionStyle ? file.toCollectionStyle() : file.toStyle()))
      .sort((a, b) => String((a as Record<string, unknown>)['type']).localeCompare(String((b as Record<string, unknown>)['type']))),
  }));
  return fonts.sort((a, b) => String(a['name']).localeCompare(String(b['name'])));
}

function deepCompact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepCompact).filter((v) => v !== null && v !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const compacted = deepCompact(v);
      if (compacted !== null && compacted !== undefined) {
        out[k] = compacted;
      }
    }
    return out;
  }
  return value;
}

/** Ruby Fontist::Import.normalize_filename — must match FormulaBuilder's
 * filename generation. */
export function normalizeFilename(name: string): string {
  return name.toLowerCase().replaceAll(' ', '_');
}

/** Ruby Fontist::Import.name_to_filename. */
export function nameToFilename(name: string): string {
  return `${normalizeFilename(name)}.yml`;
}

/** Ruby Shellwords.shelljoin. */
export function shellJoin(argv: string[]): string {
  return argv
    .map((arg) => (/[A-Za-z0-9_/=.,@%+:-]+/.test(arg) && !arg.startsWith("'") ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
    .join(' ');
}

function compactKeys(order: readonly string[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    const value = values[key];
    if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function compactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}
