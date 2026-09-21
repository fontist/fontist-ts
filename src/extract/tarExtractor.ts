import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import type { Extractor } from './extractor.js';

/** tar, tar.gz and tgz extractor on the `tar` package (gzip via zlib). */
export class TarExtractor implements Extractor {
  readonly formatId = 'tar';

  detect(bytes: Uint8Array): boolean {
    // ustar magic at offset 257; also accept gzip so .tar.gz routes here.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return true;
    if (bytes.length < 262) return false;
    const magic = 'ustar';
    for (let i = 0; i < magic.length; i++) {
      if (bytes[257 + i] !== magic.charCodeAt(i)) return false;
    }
    return true;
  }

  async extract(archivePath: string, destDir: string): Promise<string[]> {
    const before = await walk(destDir);
    await tar.x({ file: archivePath, cwd: destDir });
    const after = await walk(destDir);
    const beforeSet = new Set(before);
    return after.filter((p) => !beforeSet.has(p));
  }
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      results.push(path.join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return results;
}
