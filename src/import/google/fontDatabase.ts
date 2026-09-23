import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type { FontistContext } from '../../context.js';
import { stringifyKeys } from '../helpers/hashHelper.js';
import { GoogleImportSource } from '../../formula/importSources.js';
import type { Axis } from './models/axis.js';
import { FontFamily } from './models/fontFamily.js';
import { BaseDataSource, TtfDataSource, VfDataSource, Woff2DataSource } from './dataSources/base.js';
import { GithubDataSource } from './dataSources/github.js';
import { GoogleFormulaBuilder } from './formulaBuilders/index.js';
import type { BuilderDeps } from './formulaBuilders/baseFormulaBuilder.js';
import type { FormulaHash } from './formulaBuilders/formulaHash.js';

export interface FontDatabaseOptions {
  ctx: FontistContext;
  ttfData: FontFamily[];
  vfData?: FontFamily[];
  woff2Data?: FontFamily[];
  githubData?: FontFamily[];
  version?: number;
  sourcePath?: string | null;
}

/** Unified Google Fonts database: merges the TTF/VF/WOFF2 endpoint data and
 * the GitHub repository metadata, and generates v4/v5 formulas (Ruby
 * Google::FontDatabase). */
export class FontDatabase {
  readonly version: number;
  readonly ttfFiles = new Map<string, Record<string, string>>();
  readonly woff2Files = new Map<string, Record<string, string>>();
  readonly githubData: Map<string, FontFamily>;
  readonly fonts: Map<string, FontFamily>;

  private readonly sourcePath: string | null;
  private readonly deps: BuilderDeps;
  private commitId: string | null | undefined;

  /** Builds a v4 database (TTF endpoint + GitHub; variable fonts excluded). */
  static async buildV4(options: {
    apiKey: string;
    sourcePath: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    ctx: FontistContext;
  }): Promise<FontDatabase> {
    const ttfData = await new TtfDataSource({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl }).fetch();
    const githubData = await new GithubDataSource(options.sourcePath).fetch();
    return new FontDatabase({
      ttfData,
      githubData,
      version: 4,
      sourcePath: options.sourcePath,
      ctx: options.ctx,
    });
  }

  /** Builds a v5 database (TTF + VF + WOFF2 endpoints + GitHub). */
  static async buildV5(options: {
    apiKey: string;
    sourcePath: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    ctx: FontistContext;
  }): Promise<FontDatabase> {
    const fetchImpl = options.fetchImpl;
    const baseUrl = options.baseUrl;
    const [ttfData, vfData, woff2Data] = await Promise.all([
      new TtfDataSource({ apiKey: options.apiKey, baseUrl, fetchImpl }).fetch(),
      new VfDataSource({ apiKey: options.apiKey, baseUrl, fetchImpl }).fetch(),
      new Woff2DataSource({ apiKey: options.apiKey, baseUrl, fetchImpl }).fetch(),
    ]);
    const githubData = await new GithubDataSource(options.sourcePath).fetch();
    return new FontDatabase({
      ttfData,
      vfData,
      woff2Data,
      githubData,
      version: 5,
      sourcePath: options.sourcePath,
      ctx: options.ctx,
    });
  }

  constructor(options: FontDatabaseOptions) {
    this.version = options.version ?? 4;
    this.sourcePath = options.sourcePath ?? null;

    const ttfData = options.ttfData ?? [];
    const vfData = options.vfData ?? [];
    const woff2Data = options.woff2Data ?? [];
    const githubData = options.githubData ?? [];

    this.githubData = indexByFamily(githubData);
    this.fonts = this.mergeData(ttfData, vfData, woff2Data);

    this.deps = {
      githubIndex: this.githubData,
      ttfFiles: this.ttfFiles,
      woff2Files: this.woff2Files,
      ctx: options.ctx,
    } satisfies BuilderDeps as BuilderDeps;
  }

  allFonts(): FontFamily[] {
    return [...this.fonts.values()];
  }

  fontByName(familyName: string): FontFamily | null {
    return this.fonts.get(familyName) ?? null;
  }

  byCategory(category: string): FontFamily[] {
    return this.allFonts().filter((font) => font.category === category);
  }

  variableFontsOnly(): FontFamily[] {
    return this.allFonts().filter((font) => font.variableFont());
  }

  staticFontsOnly(): FontFamily[] {
    return this.allFonts().filter((font) => !font.variableFont());
  }

  fontsCount(): { total: number; variable: number; static: number } {
    const all = this.allFonts();
    const variable = all.filter((font) => font.variableFont()).length;
    return { total: all.length, variable, static: all.length - variable };
  }

  categories(): string[] {
    return [...new Set(this.allFonts().map((f) => f.category).filter((c): c is string => c !== null))].sort();
  }

  fontsCountByFormat(familyName: string): { ttf: boolean; woff2: boolean } {
    return { ttf: this.ttfFiles.has(familyName), woff2: this.woff2Files.has(familyName) };
  }

  ttfFilesFor(familyName: string): Record<string, string> | null {
    return this.ttfFiles.get(familyName) ?? null;
  }

  woff2FilesFor(familyName: string): Record<string, string> | null {
    return this.woff2Files.get(familyName) ?? null;
  }

  /** Generates the formula hash for a family (builders download fonts). */
  async toFormula(familyName: string): Promise<FormulaHash | null> {
    const family = this.fontByName(familyName);
    if (!family) return null;

    const formula = await GoogleFormulaBuilder.build(family, this.version, this.deps);
    const importSource = this.createImportSource(family);
    if (importSource) formula['import_source'] = importSource.toYamlObject();
    return formula;
  }

  async toFormulas(): Promise<FormulaHash[]> {
    const out: FormulaHash[] = [];
    for (const family of this.allFonts()) {
      const formula = await this.toFormula(family.family ?? '');
      if (formula) out.push(formula);
    }
    return out;
  }

  /** Saves formulas (downloading fonts) for one or all families. */
  async saveFormulas(outputDir: string, familyName?: string): Promise<string[]> {
    const families = (familyName ? [this.fontByName(familyName)] : this.allFonts()).filter(
      (f): f is FontFamily => f !== null,
    );
    const paths: string[] = [];
    for (const family of families) {
      const formula = await this.toFormula(family.family ?? '');
      if (!formula) continue;
      paths.push(this.saveFormula(formula, family.family ?? '', outputDir));
    }
    return paths;
  }

  findFontFilenameForVariant(family: FontFamily, variant: string): string | null {
    const ttfUrl = this.ttfFiles.get(family.family ?? '')?.[variant];
    if (ttfUrl) return ttfUrl.split('/').pop() ?? null;
    const woff2Url = this.woff2Files.get(family.family ?? '')?.[variant];
    if (woff2Url) return woff2Url.split('/').pop() ?? null;
    return null;
  }

  variantToType(variant: string): string {
    if (variant === 'regular') return 'Regular';
    if (variant === 'italic') return 'Italic';
    const italic = variant.match(/^(\d+)italic$/);
    if (italic) return `${italic[1]} Italic`;
    if (/^\d+$/.test(variant)) return variant;
    return variant.charAt(0).toUpperCase() + variant.slice(1);
  }

  formulaName(family: FontFamily): string {
    return (family.family ?? '').toLowerCase().replace(/\s+/g, '_');
  }

  defaultDescription(family: FontFamily): string {
    return `${family.family} font family`;
  }

  defaultHomepage(family: FontFamily): string {
    return `https://fonts.google.com/specimen/${(family.family ?? '').replace(/\s+/g, '+')}`;
  }

  saveFormula(formula: FormulaHash, familyName: string, outputDir: string): string {
    mkdirSync(outputDir, { recursive: true });
    // Google Fonts formulas always use simple filenames (live service).
    const filename = `${familyName.toLowerCase().replace(/\s+/g, '_')}.yml`;
    const target = path.join(outputDir, filename);
    writeFileSync(target, yaml.stringify(stringifyKeys(formula), { lineWidth: 0 }));
    return target;
  }

  /** Git commit of the source checkout (Ruby current_commit_id). */
  currentCommitId(): string | null {
    if (this.commitId !== undefined) return this.commitId;
    this.commitId = null;
    if (this.sourcePath && existsSync(this.sourcePath)) {
      try {
        this.commitId = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: this.sourcePath })
          .toString()
          .trim();
      } catch {
        this.commitId = null;
      }
    }
    return this.commitId;
  }

  lastModifiedFor(family: FontFamily): string {
    return family.lastModified ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  createImportSource(family: FontFamily): GoogleImportSource | null {
    const commit = this.currentCommitId();
    if (!commit) return null;
    return new GoogleImportSource({
      type: 'google',
      commit_id: commit,
      api_version: 'v1',
      last_modified: this.lastModifiedFor(family),
      family_id: (family.family ?? '').toLowerCase().replaceAll(' ', '_'),
    });
  }

  private mergeData(
    ttfData: FontFamily[],
    vfData: FontFamily[],
    woff2Data: FontFamily[],
  ): Map<string, FontFamily> {
    const merged = new Map<string, FontFamily>();

    const ttfIndex = indexByFamily(ttfData);
    const vfIndex = indexByFamily(vfData);
    const woff2Index = indexByFamily(woff2Data);

    const allFamilies = [...new Set([...ttfIndex.keys(), ...vfIndex.keys(), ...woff2Index.keys()])];

    for (const familyName of allFamilies) {
      const ttfFont = ttfIndex.get(familyName) ?? null;
      const vfFont = vfIndex.get(familyName) ?? null;
      const woff2Font = woff2Index.get(familyName) ?? null;

      const baseFont = ttfFont ?? vfFont ?? woff2Font;
      if (!baseFont) continue;

      // v4 skips fonts that are actually variable (carry axes in the VF data)
      if (this.version === 4 && vfFont?.variableFont()) continue;

      if (ttfFont) this.ttfFiles.set(familyName, ttfFont.files());
      if (woff2Font) this.woff2Files.set(familyName, woff2Font.files());

      merged.set(familyName, this.mergeFontFamily(baseFont, ttfFont, vfFont, woff2Font));
    }

    return merged;
  }

  private mergeFontFamily(
    baseFont: FontFamily,
    ttfFont: FontFamily | null,
    vfFont: FontFamily | null,
    woff2Font: FontFamily | null,
  ): FontFamily {
    const version = mostRecent([
      baseFont.version,
      ttfFont?.version,
      vfFont?.version,
      woff2Font?.version,
    ]);

    const lastModified = mostRecentDate([
      baseFont.lastModified,
      ttfFont?.lastModified,
      vfFont?.lastModified,
      woff2Font?.lastModified,
    ]);

    const filesData = ttfFont?.filesData ?? baseFont.filesData;
    const githubFamily = this.githubData.get(baseFont.family ?? '') ?? null;

    const family = new FontFamily({
      family: baseFont.family,
      variants: baseFont.variants,
      subsets: baseFont.subsets,
      version,
      lastModified,
      files: filesData,
      category: baseFont.category,
      kind: baseFont.kind,
      menu: baseFont.menu,
      axes: axisData(vfFont?.axes ?? null),
      designer: githubFamily?.designer ?? null,
      license: githubFamily?.license ?? null,
      description: githubFamily?.description ?? null,
    });
    return family;
  }
}

export { BaseDataSource, TtfDataSource, VfDataSource, Woff2DataSource, GithubDataSource };

function indexByFamily(fonts: FontFamily[]): Map<string, FontFamily> {
  const map = new Map<string, FontFamily>();
  for (const font of fonts) {
    if (font.family !== null) map.set(font.family, font);
  }
  return map;
}

function axisData(axes: Axis[] | null): Array<Record<string, unknown>> | null {
  if (!axes) return null;
  return axes.map((axis) => axis.toYamlObject());
}

function versionNumber(version: string | null): number {
  return Number.parseInt((version ?? '').replace(/[^0-9]/g, ''), 10) || 0;
}

function mostRecent(versions: Array<string | null | undefined>): string | null {
  const candidates = versions.filter((v): v is string => v !== null && v !== undefined);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) => (versionNumber(v) > versionNumber(best) ? v : best));
}

function mostRecentDate(dates: Array<string | null | undefined>): string | null {
  const candidates = dates.filter((d): d is string => d !== null && d !== undefined);
  if (candidates.length === 0) return null;
  const timestamps = candidates.map((d) => {
    const parsed = Date.parse(d);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  });
  let bestIdx = 0;
  timestamps.forEach((t, i) => {
    if (t > timestamps[bestIdx]!) bestIdx = i;
  });
  return candidates[bestIdx]!;
}
