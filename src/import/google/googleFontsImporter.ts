import { promises as fsp } from 'node:fs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../../context.js';
import { FontDatabase } from './fontDatabase.js';

export interface GoogleFontsImportOptions {
  apiKey?: string;
  sourcePath?: string;
  outputPath?: string;
  fontFamily?: string;
  verbose?: boolean;
  importCache?: string;
  force?: boolean;
  schemaVersion?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleFontsImportResults {
  success: boolean;
  successful: number;
  failed: number;
  skipped: number;
  overwritten: number;
  errors: string[];
  duration: number;
}

/** Generates Google Fonts formulas from the API + a google/fonts checkout
 * (Ruby GoogleFontsImporter). */
export class GoogleFontsImporter {
  private readonly ctx: FontistContext;
  private readonly options: GoogleFontsImportOptions;

  private successCount = 0;
  private failureCount = 0;
  private skippedCount = 0;
  private overwrittenCount = 0;
  private readonly failures: Array<{ name: string; reason: string }> = [];

  constructor(ctx: FontistContext, options: GoogleFontsImportOptions = {}) {
    this.ctx = ctx;
    this.options = options;
    if (!this.options.sourcePath) {
      throw new Error('source_path required for v4/v5 formula generation');
    }
  }

  async import(): Promise<GoogleFontsImportResults> {
    const startTime = Date.now();

    const database = await this.buildDatabase();

    const fontFamilies = this.options.fontFamily
      ? [this.options.fontFamily]
      : database.allFonts().map((f) => f.family ?? '');

    if (this.options.verbose) {
      this.ctx.ui.say(`Found ${fontFamilies.length} font families to import`);
      this.ctx.ui.say(`Saving formulas to: ${this.outputPath()}`);
      this.ctx.ui.say('');
    }

    let current = 0;
    for (const familyName of fontFamilies) {
      current += 1;
      await this.processSingleFont(database, familyName, current, fontFamilies.length);
    }

    return {
      success: this.failureCount === 0,
      successful: this.successCount,
      failed: this.failureCount,
      skipped: this.skippedCount,
      overwritten: this.overwrittenCount,
      errors: this.failures.map((f) => `${f.name}: ${f.reason}`),
      duration: Date.now() - startTime,
    };
  }

  private async buildDatabase(): Promise<FontDatabase> {
    const apiKey = this.options.apiKey ?? this.ctx.env['GOOGLE_FONTS_API_KEY'] ?? null;
    if (!apiKey) throw new Error('GOOGLE_FONTS_API_KEY environment variable not set');
    const shared = {
      apiKey,
      sourcePath: this.options.sourcePath!,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
      ctx: this.ctx,
    };
    if (this.options.verbose) {
      this.ctx.ui.say('Building font database from API...');
    }
    const database =
      this.options.schemaVersion === 5
        ? await FontDatabase.buildV5(shared)
        : await FontDatabase.buildV4(shared);
    if (this.options.verbose) {
      this.ctx.ui.say(`Database ready with ${database.allFonts().length} font families`);
      this.ctx.ui.say('');
    }
    return database;
  }

  private async processSingleFont(
    database: FontDatabase,
    familyName: string,
    current: number,
    total: number,
  ): Promise<void> {
    if (this.options.verbose) {
      this.ctx.ui.say(`(${current}/${total}) ${familyName}`);
    }

    const expectedPath = this.predictedFormulaPath(familyName);
    if (expectedPath && existsSync(expectedPath)) {
      if (this.options.force) {
        this.overwrittenCount += 1;
        if (this.options.verbose) {
          this.ctx.ui.say(`  ⚠ Overwriting existing formula: ${path.basename(expectedPath)}`);
        }
      } else {
        this.skippedCount += 1;
        if (this.options.verbose) {
          this.ctx.ui.say(`  ⊝ Skipped (already exists): ${path.basename(expectedPath)}`);
        }
        return;
      }
    }

    try {
      await fsp.mkdir(this.outputPath(), { recursive: true });
      const paths = await database.saveFormulas(this.outputPath(), familyName);
      if (paths.length === 0) {
        throw new Error(`No formula generated for ${familyName}`);
      }
      this.successCount += 1;
      if (this.options.verbose) {
        this.ctx.ui.say(`  ✓ Formula created: ${path.basename(paths[0]!)}`);
      }
    } catch (err) {
      this.failureCount += 1;
      const rawMessage = err instanceof Error ? err.message : String(err);
      this.failures.push({
        name: familyName,
        reason: rawMessage.length > 60 ? `${rawMessage.slice(0, 60)}...` : rawMessage,
      });
      if (this.options.verbose) {
        this.ctx.ui.say(`  ✗ Failed: ${this.failures[this.failures.length - 1]!.reason}`);
      }
    }
  }

  private predictedFormulaPath(familyName: string): string | null {
    try {
      const normalized = familyName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      return path.join(this.outputPath(), `${normalized}.yml`);
    } catch {
      return null;
    }
  }

  private outputPath(): string {
    return this.options.outputPath ?? './Formulas/google';
  }
}
