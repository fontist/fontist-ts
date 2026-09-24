import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../../context.js';
import { FontFile } from '../../fonts/fontFile.js';
import type { FormatMatcher } from '../../formula/formatMatcher.js';
import { mapWithConcurrency } from '../../util/concurrency.js';
import { withLock } from '../../util/locking.js';
import { SfntCollection } from '../../fonts/sfnt/collection.js';
import type {
  SystemIndexFontCollection} from './systemIndexFont.js';
import {
  collectDirectoryMtimes,
  loadCollection,
  saveCollection,
  SystemIndexFont,
  type SystemIndexFontData,
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

  /** Whether the index file exists on disk (Ruby index.file_exist?). */
  async existsOnDisk(): Promise<boolean> {
    try {
      await fsp.access(this.indexPath());
      return true;
    } catch {
      return false;
    }
  }

  /** All indexed font entries (Ruby index.fonts). */
  async entries(): Promise<SystemIndexFont[]> {
    const collection = await this.loadCollection();
    await this.ensureFresh(collection);
    return collection.allFonts();
  }

  /** Whether the index is stale relative to monitored directories and the
   * current filesystem (Ruby index.changed?). */
  async indexChangedNow(): Promise<boolean> {
    const collection = await this.loadCollection();
    const directories = await this.monitoredDirectories();
    return collection.indexChanged(directories, () => this.fontPaths());
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
    const fonts = await this.parseFonts(fontPath, stats.size, Math.floor(stats.mtimeMs));
    collection.removeByPath(fontPath);
    for (const font of fonts) {
      collection.addParsed(font);
    }
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
      const previousByPath = new Map<string, SystemIndexFontData[]>();
      for (const font of existing.all()) {
        const list = previousByPath.get(font.data.path) ?? [];
        list.push(font.data);
        previousByPath.set(font.data.path, list);
      }
      const statsByPath = await collectStats(paths);
      let processed = 0;
      const fonts = await mapWithConcurrency(paths, FONT_PARSE_CONCURRENCY, async (fontPath) => {
        const stats = statsByPath.get(fontPath);
        if (!stats) return [];
        const previous = previousByPath.get(fontPath);
        let parsed: SystemIndexFont[];
        if (
          !options.forced &&
          previous &&
          previous.length > 0 &&
          previous[0]!.file_size === stats.size &&
          previous[0]!.file_mtime === stats.mtimeMs
        ) {
          parsed = previous.map((data) => new SystemIndexFont(data));
        } else {
          parsed = await this.parseFonts(fontPath, stats.size, stats.mtimeMs);
        }
        processed += 1;
        if (paths.length > 100 && processed % 50 === 0) {
          this.ctx.ui.say(`Scanning fonts: ${processed}/${paths.length}...`);
        }
        return parsed;
      });
      const kept = fonts.flat();
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

  /** Parses one font file into index entries. Plain fonts yield a single
   * entry; collections (ttc/otc) yield one entry per face (Ruby
   * detect_collection_fonts). Faces with incomplete name records are
   * skipped individually; unreadable files are reported, not raised. */
  private async parseFonts(
    fontPath: string,
    size: number,
    mtimeMs: number,
  ): Promise<SystemIndexFont[]> {
    let fontFile: FontFile;
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(fontPath);
      fontFile = FontFile.fromBytes(bytes, fontPath);
    } catch (err) {
      this.ctx.ui.error(
        `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}` +
          `\nWarning: File at ${fontPath} not recognized as a font file.`,
      );
      return [];
    }
    const isCollection = fontFile.format === 'ttc' || fontFile.format === 'otc';
    this.checkExtensionWarning(fontPath, isCollection, bytes, fontFile);
    const faces = isCollection ? this.collectionFaces(fontPath, bytes) : [fontFile];
    const entries: SystemIndexFont[] = [];
    for (const face of faces) {
      if (!face.familyName || !face.fullName || !face.subfamilyName) {
        this.ctx.ui.error(
          `Skipping font with incomplete metadata: ${fontPath}` +
            `\nMissing attributes: full_name, family_name.` +
            '\nThis font will not be indexed, but Fontist will continue to work.',
        );
        continue;
      }
      entries.push(
        new SystemIndexFont({
          path: fontPath,
          full_name: face.fullName,
          family_name: face.familyName,
          type: face.subfamilyName ?? '',
          preferred_family_name: face.preferredFamilyName,
          preferred_subfamily_name: face.preferredSubfamilyName,
          file_size: size,
          file_mtime: mtimeMs,
          format: face.format,
          variable_font: face.isVariable,
          variable_axes: face.variableAxes,
        }),
      );
    }
    return entries;
  }

  /** Parses a collection once and yields one FontFile per face — reading
   * the file again per face would make large system TTC scans quadratic. */
  /** Ruby FontFile.check_extension_warning: warns on content/extension
   * mismatches but never fails indexing. */
  private checkExtensionWarning(filePath: string, isCollection: boolean, bytes: Buffer, fontFile: FontFile): void {
    try {
      const expectedExt = extnameOf(filePath);
      const collectionExtensions = ['ttc', 'otc', 'dfont'];
      const base = filePath.split('/').pop() ?? filePath;

      if (isCollection && !collectionExtensions.includes(expectedExt)) {
        this.ctx.ui.warn(
          `WARNING: File '${base}' has extension '.${expectedExt}' ` +
            'but appears to be a font collection (.ttc/.otc/.dfont). ' +
            'The file will be indexed, but consider renaming for clarity.',
        );
      } else if (!isCollection && collectionExtensions.includes(expectedExt)) {
        this.ctx.ui.warn(
          `WARNING: File '${base}' has collection extension '.${expectedExt}' ` +
            `but appears to be a single font (.${fontFileFormat(fontFileFormatTag(bytes))}). ` +
            'The file will be indexed, but consider renaming for clarity.',
        );
      } else if (!isCollection && expectedExt !== fontFile.format && expectedExt !== '') {
        this.ctx.ui.warn(
          `WARNING: File '${base}' has extension '.${expectedExt}' ` +
            `but appears to be a ${fontFile.format.toUpperCase()} font. ` +
            'The file will be indexed, but consider renaming for clarity.',
        );
      }
    } catch (err) {
      this.ctx.ui.debug(
        `Could not detect file format for warning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private collectionFaces(fontPath: string, bytes: Buffer): FontFile[] {
    const collection = new SfntCollection(bytes);
    const faces: FontFile[] = [];
    for (let index = 0; index < collection.faceCount(); index++) {
      try {
        faces.push(FontFile.fromBytes(bytes, fontPath, { collectionIndex: index }));
      } catch (err) {
        this.ctx.ui.debug(
          `Skipping corrupt/invalid font: ${path.basename(fontPath)}` +
            `\nValidation failed: ${String(err)}`,
        );
      }
    }
    return faces;
  }
}

function extnameOf(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function fontFileFormatTag(bytes: Buffer): string {
  return bytes.subarray(0, 4).toString('latin1');
}

function fontFileFormat(tag: string): string {
  switch (tag) {
    case '\x00\x01\x00\x00':
    case 'true':
      return 'ttf';
    case 'OTTO':
      return 'otf';
    case 'wOFF':
      return 'woff';
    case 'wOF2':
      return 'woff2';
    default:
      return 'unknown';
  }
}
