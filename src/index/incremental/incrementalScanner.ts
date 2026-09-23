import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export interface ScannedFontFile {
  path: string;
  filename: string;
  file_size: number;
  file_mtime: number;
  signature: string | null;
  format: string;
}

export type IncrementalFormat = 'truetype' | 'opentype' | 'woff' | 'woff2' | 'unknown';

/** Magic-byte format detection over the 4-byte header (Ruby
 * IncrementalScanner.detect_format). */
export function detectHeaderFormat(header: Buffer): IncrementalFormat {
  if (header.length >= 4 && header[0] === 0x00 && header[1] === 0x01 && header[2] === 0x00 && header[3] === 0x00) {
    return 'truetype';
  }
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'OTTO') {
    return 'opentype';
  }
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'wOFF') {
    return 'woff';
  }
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'wOF2') {
    return 'woff2';
  }
  return 'unknown';
}

/** SHA256 of the first 1KB — quick change detection (Ruby
 * IncrementalScanner.compute_signature). */
export async function computeSignature(fontPath: string): Promise<string | null> {
  if (!(await exists(fontPath))) return null;
  const handle = await fsp.open(fontPath, 'r');
  try {
    const header = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(header, 0, 1024, 0);
    return createHash('sha256').update(header.subarray(0, bytesRead)).digest('hex');
  } finally {
    await handle.close();
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Incremental scanner: per-file metadata with signatures and format
 * detection, plus cache-aware batch scanning (Ruby IncrementalScanner). */
export const IncrementalScanner = {
  async scanDirectory(directory: string): Promise<ScannedFontFile[]> {
    if (!(await isDirectory(directory))) return [];
    const paths = await listFontDirectory(directory);
    return Promise.all(paths.map((p) => IncrementalScanner.scanFontFile(p))).then((r) =>
      r.filter((f): f is ScannedFontFile => f !== null),
    );
  },

  async scanFontFile(fontPath: string): Promise<ScannedFontFile | null> {
    if (!(await exists(fontPath))) return null;
    const stats = await fsp.stat(fontPath);
    return {
      path: fontPath,
      filename: path.basename(fontPath),
      file_size: stats.size,
      file_mtime: Math.floor(stats.mtimeMs / 1000),
      signature: await computeSignature(fontPath),
      format: await detectFormatFromFile(fontPath),
    };
  },

  /** Reuses the cached metadata when the file is unchanged (size+mtime). */
  async scanWithCache(fontPath: string, cachedVersion: ScannedFontFile | null): Promise<ScannedFontFile | null> {
    if (!(await exists(fontPath))) return null;
    const stats = await fsp.stat(fontPath);
    if (
      cachedVersion &&
      cachedVersion.file_size === stats.size &&
      cachedVersion.file_mtime === Math.floor(stats.mtimeMs / 1000)
    ) {
      return cachedVersion;
    }
    return IncrementalScanner.scanFontFile(fontPath);
  },

  async scanBatch(paths: string[], cache: Record<string, ScannedFontFile> = {}): Promise<(ScannedFontFile | null)[]> {
    const results: (ScannedFontFile | null)[] = [];
    for (const fontPath of paths) {
      const cached = cache[fontPath];
      if (cached) {
        results.push(await IncrementalScanner.scanWithCache(fontPath, cached));
      } else {
        results.push(await IncrementalScanner.scanFontFile(fontPath));
      }
    }
    return results;
  },
};

async function detectFormatFromFile(fontPath: string): Promise<IncrementalFormat> {
  if (!(await exists(fontPath))) return 'unknown';
  const handle = await fsp.open(fontPath, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    return detectHeaderFormat(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Lists font files directly inside one directory (non-recursive),
 * mirroring Ruby PathScanning.list_font_directory. */
async function listFontDirectory(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      const full = path.join(directory, entry.name);
      if (isFontFileByName(entry.name)) results.push(full);
    }
  }
  return results;
}

function isFontFileByName(fileName: string): boolean {
  return /\.(ttf|otf|ttc|otc|dfont|woff|woff2)$/i.test(fileName);
}
