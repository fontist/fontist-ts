import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, type Stats } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type { UI } from '../ui/ui.js';

const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc', 'dfont'];
const ARCHIVE_EXTENSIONS = ['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'exe', 'cab'];

export type MigrateResult = 'migrated' | 'skipped';

export interface MigrateAllSummary {
  migrated: number;
  skipped: number;
  failed: number;
  errors: Array<{ formula: string; error: string }>;
}

export interface MigratorOptions {
  verbose?: boolean;
  dryRun?: boolean;
}

/** Migrates v4 formula YAML files to the v5 schema: adds schema_version: 5,
 * detects resource formats from extensions, and detects variable fonts from
 * `[axes]` filename patterns (Ruby V4ToV5Migrator). */
export class V4ToV5Migrator {
  constructor(
    private readonly inputPath: string,
    private readonly outputPath: string | null = null,
    private readonly options: MigratorOptions & { ui?: UI } = {},
  ) {}

  private get ui(): UI | null {
    return this.options.ui ?? null;
  }

  migrateAll(): MigrateAllSummary {
    const results: MigrateAllSummary = { migrated: 0, skipped: 0, failed: 0, errors: [] };
    const files = this.formulaFiles();
    this.log(`Found ${files.length} formula file(s) to process`);

    for (const filePath of files) {
      try {
        const result = this.migrateFile(filePath);
        if (result === 'migrated') results.migrated += 1;
        if (result === 'skipped') results.skipped += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({
          formula: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        this.log(`✗ Failed ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logSummary(results);
    return results;
  }

  migrateFile(filePath: string): MigrateResult {
    const data = this.loadYamlWithoutAliases(filePath);
    const alreadyV5 = data['schema_version'] === 5;
    if (!alreadyV5) this.addSchemaVersion(data);

    let changed = this.fileHasYamlAliases(filePath);
    if (data['resources'] !== undefined) {
      changed = this.upgradeResources(data) || changed;
    }

    if (alreadyV5 && !changed) {
      this.log(`  Already v5: ${path.basename(filePath)}`);
      return 'skipped';
    }

    const outputFile = this.outputPathFor(filePath);
    if (this.options.dryRun) {
      this.log(`  Would save: ${outputFile}`);
    } else {
      mkdirSync(path.dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, yaml.stringify(data, { lineWidth: 0 }));
      this.log(`  Saved: ${outputFile}`);
    }
    return 'migrated';
  }

  private loadYamlWithoutAliases(filePath: string): Record<string, unknown> {
    const parsed = yaml.parse(readFileSync(filePath, 'utf8'), { merge: true });
    return JSON.parse(JSON.stringify(parsed ?? {}));
  }

  /** Ruby detects aliases textually (`- *0`-style anchors). */
  private fileHasYamlAliases(filePath: string): boolean {
    return /^\s*- \*\d+/m.test(readFileSync(filePath, 'utf8'));
  }

  private formulaFiles(): string[] {
    if (!existsSync(this.inputPath)) return [];
    const stats = statSyncSafe(this.inputPath);
    if (stats === null) return [];
    if (stats.isFile()) return [this.inputPath];
    if (stats.isDirectory()) {
      return listYamlFiles(this.inputPath);
    }
    return [];
  }

  private outputPathFor(inputFile: string): string {
    if (this.outputPath === null || this.inputPath === this.outputPath) return inputFile;
    const inputIsFile = statSyncSafe(this.inputPath)?.isFile() ?? false;
    const outputIsDir = statSyncSafe(this.outputPath)?.isDirectory() ?? false;
    if (inputIsFile && outputIsDir) {
      return path.join(this.outputPath, path.basename(inputFile));
    }
    const relative = inputFile.slice(this.inputPath.length);
    return path.join(this.outputPath, relative).replace(/\/{2,}/g, '/');
  }

  private addSchemaVersion(data: Record<string, unknown>): void {
    const withVersion: Record<string, unknown> = { schema_version: 5 };
    for (const [k, v] of Object.entries(data)) withVersion[k] = v;
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, withVersion);
  }

  private upgradeResources(data: Record<string, unknown>): boolean {
    let changed = false;
    const resources = data['resources'];
    if (resources === null || typeof resources !== 'object') return false;

    for (const resourceData of Object.values(resources as Record<string, unknown>)) {
      if (resourceData === null || typeof resourceData !== 'object') continue;
      const resource = resourceData as Record<string, unknown>;

      if (this.archiveResource(resource)) continue;

      if (!resource['format']) {
        const format = this.detectFormat(resource);
        if (format) {
          resource['format'] = format;
          changed = true;
        }
      }

      if (!resource['variable_axes']) {
        const axes = this.detectVariableAxes(resource);
        if (axes.length > 0) {
          resource['variable_axes'] = axes;
          changed = true;
        }
      }
    }
    return changed;
  }

  private archiveResource(resource: Record<string, unknown>): boolean {
    const urls = this.urlsOf(resource);
    return urls.some((url) => this.archiveExtension(url));
  }

  private archiveExtension(pathName: string): boolean {
    return new RegExp(`\\.(?:${ARCHIVE_EXTENSIONS.join('|')})(?:\\?|$)`, 'i').test(pathName);
  }

  private detectFormat(resource: Record<string, unknown>): string | null {
    const urls = this.urlsOf(resource);
    for (const url of urls) {
      const format = this.formatFromName(url);
      if (format) return format;
    }
    return null;
  }

  private formatFromName(name: string): string | null {
    const match = name.match(/\.(\w+)(?:\?|$)/);
    if (!match) return null;
    const ext = match[1]!.toLowerCase();
    return FONT_EXTENSIONS.includes(ext) ? ext : null;
  }

  private detectVariableAxes(resource: Record<string, unknown>): string[] {
    const urls = this.urlsOf(resource);
    for (const url of urls) {
      const axes = this.axesFromName(url);
      if (axes.length > 0) return axes;
    }
    return [];
  }

  private axesFromName(name: string): string[] {
    const match = name.match(/\[([^\]]+)\]/);
    if (!match) return [];
    return match[1]!.split(',').map((s) => s.trim());
  }

  private urlsOf(resource: Record<string, unknown>): string[] {
    const list = resource['urls'] ?? resource['files'];
    if (!Array.isArray(list)) return [];
    return list.filter((v): v is string => typeof v === 'string');
  }

  private log(message: string): void {
    if (this.options.verbose) {
      // Ruby uses puts directly here.
      process.stdout.write(`${message}\n`);
    }
  }

  private logSummary(results: MigrateAllSummary): void {
    if (!this.options.verbose) return;
    this.ui?.say('');
    process.stdout.write(`\n${'='.repeat(60)}\n`);
    process.stdout.write('Migration Summary\n');
    process.stdout.write(`${'='.repeat(60)}\n`);
    process.stdout.write(`  Migrated: ${results.migrated}\n`);
    process.stdout.write(`  Skipped:  ${results.skipped}\n`);
    process.stdout.write(`  Failed:   ${results.failed}\n`);
    if (results.errors.length > 0) {
      process.stdout.write('\nErrors:\n');
      for (const error of results.errors) {
        process.stdout.write(`  - ${error.formula}: ${error.error}\n`);
      }
    }
    process.stdout.write(`${'='.repeat(60)}\n`);
  }
}

function statSyncSafe(p: string): Stats | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.yml')) out.push(full);
    }
  };
  walk(dir);
  return out;
}
