import { promises as fsp } from 'node:fs';
import type { FontistContext } from '../context.js';
import { FontFile } from '../fonts/fontFile.js';
import { scanFontPaths } from '../system/pathScanning.js';
import { systemFontPaths } from '../system/systemFontsData.js';
import { defaultUserFontPath } from '../system/fontDirs.js';
import { mapWithConcurrency } from '../util/concurrency.js';

export interface FontValidationResultData {
  path: string;
  valid: boolean;
  family_name: string | null;
  full_name: string | null;
  error_message: string | null;
  time_taken: number;
  file_size: number;
  file_mtime: number;
}

/** Single font validation result with timing (Ruby FontValidationResult). */
export class FontValidationResult {
  constructor(readonly data: FontValidationResultData) {}

  get valid(): boolean {
    return this.data.valid;
  }
  get path(): string {
    return this.data.path;
  }
}

export interface ReportSummary {
  generated_at: number;
  platform: string;
  total_fonts: number;
  valid_fonts: number;
  invalid_fonts: number;
  total_time: number;
  avg_time_per_font: number;
  min_time: number;
  max_time: number;
  results: FontValidationResultData[];
}

/** Validation report with summary statistics (Ruby ValidationReport). */
export class ValidationReport {
  constructor(readonly data: ReportSummary) {}

  static empty(platform: string): ValidationReport {
    return new ValidationReport({
      generated_at: Math.floor(Date.now() / 1000),
      platform,
      total_fonts: 0,
      valid_fonts: 0,
      invalid_fonts: 0,
      total_time: 0,
      avg_time_per_font: 0,
      min_time: 0,
      max_time: 0,
      results: [],
    });
  }

  validResults(): FontValidationResultData[] {
    return this.data.results.filter((r) => r.valid);
  }

  invalidResults(): FontValidationResultData[] {
    return this.data.results.filter((r) => !r.valid);
  }
}

export interface ValidationCacheData {
  generated_at: number;
  entries: FontValidationResultData[];
}

/** Validation cache with size+mtime invalidation (Ruby ValidationCache). */
export class ValidationCache {
  constructor(readonly data: ValidationCacheData) {}

  static empty(): ValidationCache {
    return new ValidationCache({ generated_at: 0, entries: [] });
  }

  static emptyData(): ValidationCache {
    return ValidationCache.empty();
  }

  static fromData(data: ValidationCacheData): ValidationCache {
    return new ValidationCache(data);
  }

  stale(): boolean {
    return this.data.generated_at === 0 || Date.now() / 1000 - this.data.generated_at > 24 * 60 * 60;
  }

  /** Cached result for a path whose file is unchanged, else null. */
  async get(fontPath: string): Promise<FontValidationResultData | null> {
    let stats;
    try {
      stats = await fsp.stat(fontPath);
    } catch {
      return null;
    }
    return (
      this.data.entries.find(
        (entry) =>
          entry.path === fontPath &&
          entry.file_size === stats.size &&
          entry.file_mtime === Math.floor(stats.mtimeMs / 1000),
      ) ?? null
    );
  }

  set(result: FontValidationResultData): void {
    this.data.entries = this.data.entries.filter((e) => e.path !== result.path);
    this.data.entries.push(result);
    this.data.generated_at = Math.floor(Date.now() / 1000);
  }

  get entries(): FontValidationResultData[] {
    return this.data.entries;
  }
}

export interface ValidateOptions {
  parallel?: boolean;
  cache?: ValidationCache | null;
  verbose?: boolean;
}

/** Validates all system font files with timing, caching, and a summary
 * report (Ruby Validator). */
export class Validator {
  private report = ValidationReport.empty('unknown');

  constructor(private readonly ctx: FontistContext) {}

  async validateAll(options: ValidateOptions = {}): Promise<ValidationReport> {
    const useParallel = options.parallel ?? true;
    const cache = options.cache ?? null;
    const fontPaths = await this.scanFontPaths();

    if (options.verbose) {
      this.ctx.ui.say(`Found ${fontPaths.length} font files to validate`);
      if (cache) {
        this.ctx.ui.say(`Using cache with ${cache.entries.length} entries`);
      }
    }

    const cacheLookup = new Map<string, FontValidationResultData>();
    for (const entry of cache?.entries ?? []) {
      cacheLookup.set(entry.path, entry);
    }

    const validate = (fontPath: string) => this.validateWithCacheLookup(fontPath, cacheLookup);
    const results =
      useParallel && fontPaths.length > 10
        ? await mapWithConcurrency(fontPaths, 8, validate)
        : await Promise.all(fontPaths.map(validate));

    this.report = ValidationReport.empty(this.ctx.platform);
    this.report.data.results = results;
    this.calculateSummary(this.report);
    return this.report;
  }

  async validateSingle(fontPath: string): Promise<FontValidationResultData> {
    const startTime = Date.now();
    let fileSize = 0;
    let fileMtime = 0;
    try {
      const { promises: fsp } = await import('node:fs');
      const stats = await fsp.stat(fontPath);
      fileSize = stats.size;
      fileMtime = Math.floor(stats.mtimeMs / 1000);
    } catch {
      // missing file: validation will fail with the error message
    }

    let familyName: string | null = null;
    let fullName: string | null = null;
    let errorMessage: string | null = null;
    let valid = false;
    try {
      const fontFile = await FontFile.fromPath(fontPath);
      familyName = fontFile.familyName;
      fullName = fontFile.fullName;
      valid = familyName !== null && fullName !== null;
      if (!valid) {
        errorMessage = 'Font is missing required name records';
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    return {
      path: fontPath,
      valid,
      family_name: familyName,
      full_name: fullName,
      error_message: errorMessage,
      time_taken: (Date.now() - startTime) / 1000,
      file_size: fileSize,
      file_mtime: fileMtime,
    };
  }

  private async validateWithCacheLookup(
    fontPath: string,
    cacheLookup: Map<string, FontValidationResultData>,
  ): Promise<FontValidationResultData> {
    const cached = cacheLookup.get(fontPath);
    if (cached && (await this.fileUnchanged(fontPath, cached))) {
      return cached;
    }
    return this.validateSingle(fontPath);
  }

  private async fileUnchanged(
    fontPath: string,
    cachedResult: FontValidationResultData,
  ): Promise<boolean> {
    try {
      const { promises: fsp } = await import('node:fs');
      const stats = await fsp.stat(fontPath);
      return (
        cachedResult.file_size === stats.size &&
        cachedResult.file_mtime === Math.floor(stats.mtimeMs / 1000)
      );
    } catch {
      return false;
    }
  }

  private calculateSummary(report: ValidationReport): void {
    const times = report.data.results.map((r) => r.time_taken);
    report.data.total_fonts = report.data.results.length;
    report.data.valid_fonts = report.data.results.filter((r) => r.valid).length;
    report.data.invalid_fonts = report.data.total_fonts - report.data.valid_fonts;
    report.data.total_time = times.reduce((sum, t) => sum + t, 0);
    report.data.avg_time_per_font = times.length === 0 ? 0 : report.data.total_time / times.length;
    report.data.min_time = times.length === 0 ? 0 : Math.min(...times);
    report.data.max_time = times.length === 0 ? 0 : Math.max(...times);
  }

  private async scanFontPaths(): Promise<string[]> {
    const dirs = [
      ...(await systemFontPaths(this.ctx)),
      defaultUserFontPath(this.ctx.platform, this.ctx.env),
      this.ctx.paths.fontsPath(),
    ];
    const results: string[] = [];
    for (const dir of dirs) {
      results.push(...(await scanFontPaths([dir])));
    }
    return Array.from(new Set(results)).sort();
  }
}
