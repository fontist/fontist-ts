import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { isFontExtension } from '../fonts/fontFile.js';
import { isExcludedFont } from './systemFontsData.js';

const MAX_SCAN_DEPTH = 8;

export interface FontScanTarget {
  dir: string;
  /** Allowed extensions (lowercase, no dot); omitted = every font extension. */
  extensions?: string[];
}

/** Recursively collects font files under the given roots, filtered by
 * extension (case-insensitive) and the exclusion list; permission errors
 * on unreadable directories are swallowed (as in the Ruby gem). */
export async function scanFontPaths(roots: string[]): Promise<string[]> {
  return scanFontTargets(roots.map((dir) => ({ dir })));
}

/** Per-root extension-filtered variant (Ruby system.yml patterns embed a
 * per-line extension set, e.g. macOS system dirs are ttf/ttc only). */
export async function scanFontTargets(targets: FontScanTarget[]): Promise<string[]> {
  const results: string[] = [];
  for (const target of targets) {
    await scanDir(target.dir, 0, results, target.extensions ?? []);
  }
  return results.sort();
}

async function scanDir(dir: string, depth: number, results: string[], extensions: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // EACCES / EPERM / vanished dir
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(full, depth + 1, results, extensions);
    } else if (
      entry.isFile() &&
      !entry.name.startsWith('.') &&
      isFontFile(entry.name, extensions) &&
      !isExcludedFont(entry.name)
    ) {
      results.push(full);
    }
  }
}

export function isFontFile(fileName: string, allowedExtensions: string[] = []): boolean {
  const extension = path.extname(fileName).replace('.', '').toLowerCase();
  if (extension.length === 0) return false;
  if (allowedExtensions.length === 0) return isFontExtension(extension);
  return allowedExtensions.includes(extension);
}
