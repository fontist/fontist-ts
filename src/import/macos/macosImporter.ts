import { promises as fsp } from 'node:fs';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FontistContext } from '../../context.js';
import { FontNotFoundError } from '../../errors/errors.js';
import { MacosImportSource } from '../../formula/importSources.js';
import { CreateFormula } from '../createFormula.js';
import { ImportDisplay } from '../importDisplay.js';
import { type CatalogAsset } from './catalog/asset.js';
import { CatalogManager } from './catalog/catalogManager.js';

const HOMEPAGE = 'https://support.apple.com/en-om/HT211240#document';

const MACOS_LICENSE_PATH = fileURLToPath(new URL('./macos_license.txt', import.meta.url));

function platformsFor(frameworkVersion: number): string[] {
  return frameworkVersion >= 3 && frameworkVersion <= 8
    ? [`macos-font${frameworkVersion}`]
    : ['macos'];
}

function versionDirName(frameworkVersion: number): string {
  return frameworkVersion >= 3 && frameworkVersion <= 8 ? `font${frameworkVersion}` : '';
}

export interface MacosImportOptions {
  formulasDir?: string;
  fontName?: string;
  force?: boolean;
  verbose?: boolean;
  importCache?: string;
  schemaVersion?: number;
}

/** Imports macOS supplementary fonts from a MobileAsset catalog plist
 * (Ruby MacosImporter). */
export class MacosImporter {
  private readonly options: MacosImportOptions;
  private readonly ctx: FontistContext;
  private readonly catalogPath: string;

  private successCount = 0;
  private failureCount = 0;
  private skippedCount = 0;
  private readonly failures: Array<{
    name: string;
    error: string;
    parsingErrors: Array<{ path: string; message: string }>;
    url: string;
  }> = [];

  constructor(ctx: FontistContext, catalogPath: string, options: MacosImportOptions = {}) {
    this.ctx = ctx;
    this.catalogPath = catalogPath;
    this.options = options;
  }

  async call(): Promise<void> {
    this.printHeader();

    const parser = CatalogManager.parserFor(this.catalogPath);
    const assets = this.filterAssets(parser.assets());

    if (assets.length === 0) {
      this.ctx.ui.say('');
      this.ctx.ui.say('No fonts to import. Exiting.');
      return;
    }

    if (this.options.fontName) {
      this.ctx.ui.say(`Filter: ${this.options.fontName}`);
    }
    this.ctx.ui.say(`Found ${assets.length} font packages in catalog`);
    this.ctx.ui.say(`Saving formulas to: ${this.formulaDirFor(parser.frameworkVersion())}`);
    this.ctx.ui.say(`Mode: ${this.options.force ? 'Force (overwrite existing)' : 'Normal (skip existing)'}`);
    this.ctx.ui.say('');

    let current = 0;
    for (const asset of assets) {
      current += 1;
      await this.processAsset(asset, current, assets.length);
    }
  }

  private printHeader(): void {
    this.ctx.ui.say('');
    this.ctx.ui.say('─'.repeat(80));
    this.ctx.ui.say('  macOS Supplementary Fonts Import');
    this.ctx.ui.say('─'.repeat(80));
    this.ctx.ui.say('');
    if (this.options.verbose) {
      this.ctx.ui.say(`  Import cache: ${this.options.importCache ?? this.ctx.paths.importCachePath(this.ctx.env)}`);
      this.ctx.ui.say(`  Formula output: ${this.ctx.paths.formulasPath()}`);
    }
  }

  private filterAssets(assets: CatalogAsset[]): CatalogAsset[] {
    if (!this.options.fontName) return assets;
    const needle = this.options.fontName.toLowerCase();
    const filtered = assets.filter((asset) =>
      (asset.primaryFamilyName() ?? '').toLowerCase().includes(needle),
    );
    if (filtered.length === 0) {
      this.ctx.ui.error(`No fonts matching '${this.options.fontName}' found in catalog`);
    }
    return filtered;
  }

  private async processAsset(asset: CatalogAsset, current: number, total: number): Promise<void> {
    if (asset.fonts().length === 0) return;

    const familyName = asset.primaryFamilyName() ?? 'Unknown';
    const fontsCount = asset.fonts().length;
    const percentage = ((current / total) * 100).toFixed(1);
    this.ctx.ui.say(
      `(${current}/${total}) ${percentage}% | ${familyName} (${fontsCount} font${fontsCount > 1 ? 's' : ''})`,
    );

    const importSourceInit = asset.toImportSource();
    const importSource = importSourceInit ? new MacosImportSource(importSourceInit) : null;

    try {
      const formulaPath = await new CreateFormula(this.ctx, asset.downloadUrl(), {
        platforms: platformsFor(asset.frameworkVersion ?? 0),
        homepage: HOMEPAGE,
        requiresLicenseAgreement: this.licenseText(),
        formulaDir: this.formulaDirFor(asset.frameworkVersion ?? 0),
        keepExisting: !this.options.force,
        importSource: importSource ?? undefined,
        verbose: this.options.verbose,
        importCache: this.options.importCache,
        name: familyName,
        schemaVersion: this.options.schemaVersion,
      }).call();

      const stats = await fsp.stat(formulaPath);
      const wasJustCreated = Date.now() - stats.mtimeMs < 2000;
      const formulaName = path.basename(formulaPath);
      if (wasJustCreated) {
        this.successCount += 1;
        this.ctx.ui.say(`  ✓ Formula created: ${formulaName}`);
      } else {
        this.skippedCount += 1;
        this.ctx.ui.say(`  ⊝ Skipped (already exists): ${formulaName}`);
        this.ctx.ui.say('    ℹ Use --force to overwrite existing formulas');
      }
    } catch (err) {
      this.failureCount += 1;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const parsingErrors =
        err instanceof FontNotFoundError && err.hasParsingErrors()
          ? err.parsingErrors.map((message) => ({ path: 'archive', message }))
          : [];
      this.failures.push({
        name: familyName,
        error: rawMessage.length > 60 ? `${rawMessage.slice(0, 60)}...` : rawMessage,
        parsingErrors,
        url: asset.downloadUrl(),
      });
      this.ctx.ui.say(`  ✗ Failed: ${rawMessage.slice(0, 60)}`);
    }
  }

  private licenseText(): string {
    return readFileSync(MACOS_LICENSE_PATH, 'utf8');
  }

  private formulaDirFor(frameworkVersion: number): string {
    if (this.options.formulasDir) {
      return this.options.formulasDir;
    }
    const versionDir = versionDirName(frameworkVersion);
    const base = path.join(this.ctx.paths.formulasPath(), 'macos');
    return versionDir ? path.join(base, versionDir) : base;
  }
}

export { ImportDisplay };
