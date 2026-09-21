import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { UnknownArchiveError } from '../errors/errors.js';
import type { Extractor } from './extractor.js';

/** Extractor delegating to a system 7-Zip binary, covering the containers
 * pure-JS extractors cannot handle (7z, cab, msi, exe SFX) — the same
 * strategy the Ruby gem's excavate used. The binary is resolved lazily so
 * registry construction stays synchronous. */
export class ProcessExtractor implements Extractor {
  readonly formatId: string;

  constructor(
    formatId: string,
    private readonly signature: (bytes: Uint8Array) => boolean,
    private readonly binaries: readonly string[] = ['7z', '7zz'],
  ) {
    this.formatId = formatId;
  }

  detect(bytes: Uint8Array): boolean {
    return this.signature(bytes);
  }

  async extract(archivePath: string, destDir: string): Promise<string[]> {
    const binary = await resolveBinary(this.binaries);
    if (!binary) {
      throw new UnknownArchiveError(
        `Extracting ${this.formatId} archives requires 7-Zip ("7z" or "7zz") on PATH: ${archivePath}`,
      );
    }
    await fsp.mkdir(destDir, { recursive: true });
    const before = new Set(await walkFiles(destDir));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['x', '-y', `-o${destDir}`, archivePath], { stdio: 'ignore' });
      child.on('error', (err) => reject(new UnknownArchiveError(`7-Zip failed to start: ${String(err)}`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new UnknownArchiveError(`7-Zip could not extract ${archivePath} (exit ${code})`));
      });
    });
    const after = await walkFiles(destDir);
    return after.filter((file) => !before.has(file));
  }
}

async function resolveBinary(candidates: readonly string[]): Promise<string | null> {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const candidate of candidates) {
    for (const dir of pathDirs) {
      if (dir.length === 0) continue;
      const full = path.join(dir, candidate);
      if (await fsp.access(full).then(() => true).catch(() => false)) {
        return full;
      }
    }
  }
  return null;
}

async function walkFiles(dir: string): Promise<string[]> {
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
  return results.sort();
}
