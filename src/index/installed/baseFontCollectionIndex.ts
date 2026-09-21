import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../../context.js';
import { FontFile } from '../../fonts/fontFile.js';
import type { FormatMatcher } from '../../formula/formatMatcher.js';
import type {
  SystemIndexFontCollection} from './systemIndexFont.js';
import {
  collectDirectoryMtimes,
  loadCollection,
  saveCollection,
  SystemIndexFont
} from './systemIndexFont.js';

/** Shared behavior of installed-font indexes: persistent scan collection,
 * lazy build, mtime short-circuit, add/remove, find. Concrete subclasses
 * declare which paths to scan and where the index lives. */
export abstract class BaseFontCollectionIndex {
  protected collection: SystemIndexFontCollection | null = null;

  constructor(
    protected readonly ctx: FontistContext,
    protected readonly formatMatcher: FormatMatcher | null = null,
  ) {}

  protected abstract indexPath(): string;
  protected abstract fontPaths(): Promise<string[]>;

  async find(name: string, style: string | null = null): Promise<SystemIndexFont[]> {
    const collection = await this.loadCollection();
    return collection.find(name, style, this.formatMatcher);
  }

  /** Returns the first matching font path or null. */
  async findPath(name: string, style: string | null = null): Promise<string | null> {
    const matches = await this.find(name, style);
    return matches[0]?.path ?? null;
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

  /** Rescans the indexed paths; reuses entries whose size+mtime are unchanged
   * unless `forced`, and short-circuits entirely when directory mtimes say
   * nothing could have changed. */
  async rebuild(options: { forced?: boolean } = {}): Promise<void> {
    const paths = await this.fontPaths();
    const directories = uniqueDirectories(paths);
    const collection = await loadCollection(this.indexPath());
    if (!options.forced && (await collection.isIndexUnchanged(directories))) {
      return;
    }
    const previousByPath = new Map(collection.all().map((font) => [font.data.path, font.data]));
    const fonts: SystemIndexFont[] = [];
    for (const fontPath of paths) {
      const stats = await fsp.stat(fontPath).catch(() => null);
      if (!stats) continue;
      const previous = previousByPath.get(fontPath);
      if (
        !options.forced &&
        previous &&
        previous.file_size === stats.size &&
        previous.file_mtime === Math.floor(stats.mtimeMs)
      ) {
        fonts.push(new SystemIndexFont(previous));
        continue;
      }
      try {
        fonts.push(await this.parseFont(fontPath, stats.size, Math.floor(stats.mtimeMs)));
      } catch (err) {
        this.ctx.ui.debug(`Skipping unreadable font ${fontPath}: ${String(err)}`);
      }
    }
    collection.replaceAll(fonts, Date.now(), await collectDirectoryMtimes(directories));
    await saveCollection(this.indexPath(), collection);
  }

  private async parseFont(
    fontPath: string,
    size: number,
    mtimeMs: number,
  ): Promise<SystemIndexFont> {
    const fontFile = await FontFile.fromPath(fontPath);
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
    return this.collection;
  }
}

function uniqueDirectories(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => path.dirname(p)))).sort();
}
