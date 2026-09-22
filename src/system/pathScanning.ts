import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { isFontExtension } from '../fonts/fontFile.js';
import { isExcludedFont } from './systemFontsData.js';

const MAX_SCAN_DEPTH = 8;

/** Recursively collects font files under the given roots, filtered by
 * extension (case-insensitive) and the exclusion list; permission errors
 * on unreadable directories are swallowed (as in the Ruby gem). */
export async function scanFontPaths(roots: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const root of roots) {
    await scanDir(root, 0, results);
  }
  return results.sort();
}

async function scanDir(dir: string, depth: number, results: string[]): Promise<void> {
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
      await scanDir(full, depth + 1, results);
    } else if (entry.isFile() && !entry.name.startsWith('.') && isFontFile(entry.name) && !isExcludedFont(entry.name)) {
      results.push(full);
    }
  }
}

export function isFontFile(fileName: string): boolean {
  const extension = path.extname(fileName).replace('.', '');
  return extension.length > 0 && isFontExtension(extension);
}
