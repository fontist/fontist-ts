import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type { FontistContext } from '../../context.js';
import { normalizeKey } from './formulaKey.js';
import { WindowsFodMetadata } from './windowsFodMetadata.js';

const HOMEPAGE =
  'https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list';

const WINDOWS_LICENSE_PATH = fileURLToPath(new URL('./windows_license.txt', import.meta.url));

function detectFormat(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return ['ttf', 'ttc', 'otf', 'otc'].includes(ext) ? ext : 'ttf';
}

/** Generates Windows FOD formula files for all capabilities (Ruby
 * Fontist::Import::Windows). */
export class WindowsImport {
  private readonly formulasDir: string | null;

  constructor(
    private readonly ctx: FontistContext,
    options: { formulasDir?: string } = {},
  ) {
    this.formulasDir = options.formulasDir ?? null;
  }

  call(): void {
    const capabilities = WindowsFodMetadata.allCapabilities();

    this.ctx.ui.say(`Generating ${capabilities.length} Windows FOD formula files...`);

    for (const capName of capabilities) {
      this.generateFormula(capName);
    }

    this.ctx.ui.say(`Done. ${capabilities.length} formulas generated.`);
  }

  private generateFormula(capName: string): void {
    const description = WindowsFodMetadata.descriptionForCapability(capName) ?? capName;
    const fontsData = WindowsFodMetadata.fontsForCapability(capName) ?? {};
    const formula = this.buildFormula(capName, description, fontsData);
    const fontCount = Object.values(fontsData).reduce(
      (sum, data) => sum + stylesOf(data).length,
      0,
    );
    this.writeFormula(description, formula, fontCount);
  }

  private writeFormula(description: string, formula: Record<string, unknown>, fontCount: number): void {
    const target = this.formulaPath(description);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, yaml.stringify(formula, { lineWidth: 0 }));
    this.ctx.ui.say(`  Created: ${path.basename(target)} (${fontCount} fonts)`);
  }

  private buildFormula(
    capName: string,
    description: string,
    fontsData: Record<string, Record<string, unknown>>,
  ): Record<string, unknown> {
    const allFonts = this.collectFontFilenames(fontsData);
    const formats = [...new Set(allFonts.map(detectFormat))];

    const resource: Record<string, unknown> = {
      source: 'windows_fod',
      capability_name: capName,
    };
    if (formats.length === 1) resource['format'] = formats[0];

    const importSource = {
      type: 'windows',
      capability_name: capName,
      min_windows_version: '10.0',
    };

    return {
      schema_version: 5,
      name: description,
      description: `${description} for Windows`,
      homepage: HOMEPAGE,
      platforms: ['windows'],
      open_license: this.licenseText(),
      resources: { [normalizeKey(description)]: resource },
      fonts: this.buildFonts(fontsData),
      import_source: importSource,
    };
  }

  private collectFontFilenames(fontsData: Record<string, Record<string, unknown>>): string[] {
    return Object.values(fontsData).flatMap((data) => stylesOf(data).map((style) => String(style['font'] ?? '')));
  }

  private buildFonts(
    fontsData: Record<string, Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    return Object.entries(fontsData).map(([familyName, data]) => ({
      name: familyName,
      styles: stylesOf(data).map((style) => ({
        family_name: familyName,
        type: style['type'],
        font: style['font'],
        formats: [detectFormat(String(style['font'] ?? ''))],
        variable_font: false,
      })),
    }));
  }

  private licenseText(): string {
    return readFileSync(WINDOWS_LICENSE_PATH, 'utf8');
  }

  private formulaPath(description: string): string {
    const dir = this.formulasDir ?? path.join(this.ctx.paths.formulasPath(), 'windows');
    return path.join(dir, `${normalizeKey(description)}.yml`);
  }
}

function stylesOf(data: Record<string, unknown>): Array<Record<string, unknown>> {
  return (data['styles'] as Array<Record<string, unknown>>) ?? [];
}
