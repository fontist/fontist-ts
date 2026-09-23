import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import type { FontistContext } from '../context.js';
import { withLock } from '../util/locking.js';
import { atomicWriteFile, mkdirp, pathExists } from '../util/fsx.js';

interface CacheIndex {
  [url: string]: string;
}

/** URL → file cache under `~/.fontist/downloads`, indexed by `map.yml`
 * (URLs map to relative stored paths, keeping the directory relocatable). */
export class DownloadCache {
  private readonly ctx: FontistContext;
  private readonly directoryOverride: string | null;

  constructor(ctx: FontistContext, directoryOverride: string | null = null) {
    this.ctx = ctx;
    this.directoryOverride = directoryOverride;
  }

  directory(): string {
    return this.directoryOverride ?? this.ctx.paths.downloadsPath();
  }

  mapPath(): string {
    return path.join(this.directory(), 'map.yml');
  }

  async get(url: string): Promise<string | null> {
    const relative = (await this.readMap())[url];
    if (!relative) return null;
    const absolute = path.join(this.directory(), relative);
    return (await pathExists(absolute)) ? absolute : null;
  }

  /** Copies `sourcePath` into the cache and indexes it for `url`.
   * Returns the stored absolute path. */
  async put(url: string, sourcePath: string): Promise<string> {
    const fileName = storedName(urlFileName(url, sourcePath));
    const relative = path.join(`f${Date.now()}-${Math.floor(Math.random() * 1e6)}`, fileName);
    const target = path.join(this.directory(), relative);
    await mkdirp(path.dirname(target));
    await fsp.copyFile(sourcePath, target);
    await withLock(`${this.mapPath()}.lock`, async () => {
      const map = await this.readMap();
      map[url] = relative;
      await atomicWriteFile(this.mapPath(), yaml.stringify(map, { lineWidth: 0 }));
    });
    return target;
  }

  async allFetched(urls: string[]): Promise<boolean> {
    if (urls.length === 0) return false;
    const map = await this.readMap();
    for (const url of urls) {
      const relative = map[url];
      if (!relative || !(await pathExists(path.join(this.directory(), relative)))) {
        return false;
      }
    }
    return true;
  }

  async clear(): Promise<void> {
    await withLock(`${this.mapPath()}.lock`, async () => {
      await atomicWriteFile(this.mapPath(), yaml.stringify({}, { lineWidth: 0 }));
    });
  }

  private async readMap(): Promise<CacheIndex> {
    try {
      const text = await fsp.readFile(this.mapPath(), 'utf8');
      const parsed = yaml.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CacheIndex;
      }
    } catch {
      // missing or unreadable map: empty cache
    }
    return {};
  }
}

function storedName(name: string): string {
  const sanitized = Array.from(name).map((ch) => (isUnsafeNameChar(ch) ? '_' : ch)).join('');
  return sanitized.length > 255 ? sanitized.slice(0, 248) + sanitized.slice(-6) : sanitized;
}

function isUnsafeNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    code < 0x20 ||
    ch === '/' ||
    ch === '\\' ||
    ch === '?' ||
    ch === '%' ||
    ch === '*' ||
    ch === ':' ||
    ch === '|' ||
    ch === '"' ||
    ch === '<' ||
    ch === '>' ||
    ch === '`' ||
    ch === "'"
  );
}

function urlFileName(url: string, sourcePath: string): string {
  try {
    const parsed = new URL(url);
    const name = path.basename(parsed.pathname);
    if (name.length > 0 && name !== '.') return name;
  } catch {
    // not a parsable URL; fall back to the source file name
  }
  const fromSource = path.basename(sourcePath);
  if (fromSource.length > 0 && fromSource !== '.' && fromSource !== '/') return fromSource;
  return 'download';
}
