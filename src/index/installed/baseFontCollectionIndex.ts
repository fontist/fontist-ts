import { promises as fsp } from 'node:fs';
import type { FontistContext } from '../../context.js';
import { FontFile } from '../../fonts/fontFile.js';
import { FontIndexabilityValidationError } from '../../errors/errors.js';
import type { FormatMatcher } from '../../formula/formatMatcher.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { withLock } from '../../util/locking.js';
import type {
  SystemIndexFontCollection} from './systemIndexFont.js';
import {
  collectDirectoryMtimes,
  loadCollection,
  saveCollection,
  SystemIndexFont
} from './systemIndexFont.js';

const FONT_PARSE_CONCURRENCY = 8;

async function collectStats(paths: string[]): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const result = new Map<string, { size: number; mtimeMs: number }>();
  await Promise.all(
    paths.map(async (fontPath) => {
      const stats = await fsp.stat(fontPath).catch(() => null);
      if (stats) {
        result.set(fontPath, { size: stats.size, mtimeMs: Math.floor(stats.mtimeMs) });
      }
    }),
  );
  return result;
}

/** Shared behavior of installed-font indexes, ported from Ruby's
 * `BaseFontCollectionIndex` + `SystemIndexFontCollection`: persistent scan
 * collection, lazy build, session-verified change detection, cross-process
 * rebuild lock with 60s adoption, add/remove, and find. Concrete subclasses
 * declare which paths to scan, where the index lives, and which directories
 * are monitored for change detection. */
export abstract class BaseFontCollectionIndex {
  protected collection: SystemIndexFontCollection | null = null;

  constructor(
    protected readonly ctx: FontistContext,
    protected readonly formatMatcher: FormatMatcher | null = null,
  ) {}

  protected abstract indexPath(): string;
  protected abstract fontPaths(): Promise<string[]>;

  /** Directories whose mtimes gate change detection (Ruby
   * `extract_font_directories`: the configured template base dirs plus the
   * index's own scan root). */
  protected abstract monitoredDirectories(): Promise<string[]>;

  /** Enables Ruby's `read_only_mode`: finds skip change detection. */
  async readOnlyMode(): Promise<this> {
    const collection = await this.loadCollection();
    collection.readOnly = true;
    return this;
  }

  async find(name: string, style: string | null = null): Promise<SystemIndexFont[] | null> {
    const collection = await this.loadCollection();
    await this.ensureFresh(collection);
    return collection.find(name, style, this.formatMatcher);
  }

  /** Returns the first matching font path or null. */
  async findPath(name: string, style: string | null = null): Promise<string | null> {
    const matches = await this.find(name, style);
    return matches?.[0]?.path ?? null;
  }

  async addFont(fontPath: string): Promise<void> {
    const collection = await this.loadCollection();
    const stats = await fsp.stat(fontPath);
    const font = await this.parseFont(fontPath, stats.size, Math.floor(stats.mtimeMs));
    collection.removeByPath(fontPath);
    collection.addParsed(font);
    await saveCollection(this.indexPath(), collection);
  }

  async removeFont(fontPath: string): Promise<boolean> {
    const collection = await this.loadCollection();
    const removed = collection.removeByPath(fontPath);
    if (removed) {
      await saveCollection(this.indexPath(), collection);
    }
    return removed;
  }

  /** Locked rebuild (Ruby `rebuild_with_lock`): after acquiring the lock,
   * an on-disk index rebuilt within the last 60 seconds by another process
   * is adopted wholesale instead of rescanning. */
  async rebuild(options: { forced?: boolean } = {}): Promise<void> {
    const lockPath = `${this.indexPath()}.lock`;
    await withLock(lockPath, async () => {
      const existing = await loadCollection(this.indexPath());
      if (existing.isRecentlyScanned()) {
        this.ctx.ui.debug('Index recently rebuilt by another process, using existing');
        this.collection = existing;
        this.collection.markVerified();
        return;
      }

      const paths = await this.fontPaths();
      if (paths.length > 100) {
        this.ctx.ui.say(`Building font index (${paths.length} fonts found, this may take a while...)`);
      }
      const directories = await this.monitoredDirectories();
      const previousByPath = new Map(existing.all().map((font) => [font.data.path, font.data]));
      const statsByPath = await collectStats(paths);
      let processed = 0;
      const fonts = await mapWithConcurrency(paths, FONT_PARSE_CONCURRENCY, async (fontPath) => {
        const stats = statsByPath.get(fontPath);
        if (!stats) return null;
        const previous = previousByPath.get(fontPath);
        let parsed: SystemIndexFont | null = null;
        if (
          !options.forced &&
          previous &&
          previous.file_size === stats.size &&
          previous.file_mtime === stats.mtimeMs
        ) {
          parsed = new SystemIndexFont(previous);
        } else {
          try {
            parsed = await this.parseFont(fontPath, stats.size, stats.mtimeMs);
          } catch (err) {
            this.ctx.ui.debug(`Skipping unreadable font ${fontPath}: ${String(err)}`);
          }
        }
        processed += 1;
        if (paths.length > 100 && processed % 50 === 0) {
          this.ctx.ui.say(`Scanning fonts: ${processed}/${paths.length}...`);
        }
        return parsed;
      });
      const kept = fonts.filter((font): font is SystemIndexFont => font !== null);
      const collection = this.collection ?? existing;
      collection.replaceAll(kept, Date.now(), await collectDirectoryMtimes(directories));
      collection.markVerified();
      await saveCollection(this.indexPath(), collection);
      this.collection = collection;
      if (kept.length > 100) {
        this.ctx.ui.say(`Font index built: ${kept.length} fonts indexed.`);
      }
    });
  }

  /** Ruby `check_index` on load; a valid existing file is also marked
   * verified for the session (Ruby SystemIndex module behavior). */
  private async loadCollection(): Promise<SystemIndexFontCollection> {
    if (this.collection) return this.collection;
    const fileExists = await fsp
      .access(this.indexPath())
      .then(() => true)
      .catch(() => false);
    if (!fileExists) {
      await this.rebuild();
    }
    this.collection = await loadCollection(this.indexPath());
    if (fileExists) {
      this.collection.checkIndex();
      this.collection.markVerified();
    }
    return this.collection;
  }

  private async ensureFresh(collection: SystemIndexFontCollection): Promise<void> {
    if (collection.readOnly) return;
    const directories = await this.monitoredDirectories();
    if (await collection.indexChanged(directories, () => this.fontPaths())) {
      await this.rebuild();
    }
  }

  private async parseFont(
    fontPath: string,
    size: number,
    mtimeMs: number,
  ): Promise<SystemIndexFont> {
    const fontFile = await FontFile.fromPath(fontPath);
    // Indexability gate (Ruby's :indexability validation): fonts without the
    // required name records would fail check_index on every later load.
    if (!fontFile.familyName || !fontFile.fullName || !fontFile.subfamilyName) {
      throw new FontIndexabilityValidationError(
        `Font ${fontPath} misses family/full/subfamily name records required for indexing`,
      );
    }
    return new SystemIndexFont({
      path: fontPath,
      full_name: fontFile.fullName,
      family_name: fontFile.familyName,
      type: fontFile.subfamilyName,
      preferred_family_name: fontFile.preferredFamilyName,
      preferred_subfamily_name: fontFile.preferredSubfamilyName,
      file_size: size,
      file_mtime: mtimeMs,
      format: fontFile.format,
      variable_font: fontFile.isVariable,
      variable_axes: fontFile.variableAxes,
    });
  }
}
