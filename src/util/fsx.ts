import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export async function mkdirp(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  await mkdirp(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, filePath);
}

export async function copyFileTo(source: string, targetPath: string): Promise<void> {
  await mkdirp(path.dirname(targetPath));
  await fsp.copyFile(source, targetPath);
}

export async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function basename(p: string): string {
  return path.basename(p);
}

export function extname(p: string): string {
  return path.extname(p);
}

export function joinPath(...parts: string[]): string {
  return path.join(...parts);
}

/** Normalizes separators and trailing slashes for cross-platform comparisons. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return fsp.readFile(filePath, 'utf8');
}

export async function writeTextFile(filePath: string, data: string): Promise<void> {
  await mkdirp(path.dirname(filePath));
  await fsp.writeFile(filePath, data, 'utf8');
}
