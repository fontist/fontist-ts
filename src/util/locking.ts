import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { mkdirp } from './fsx.js';

export interface LockOptions {
  /** How long to keep trying to acquire the lock, in ms. */
  timeoutMs?: number;
  /** Age (ms) after which an abandoned lock file is considered stale and removed. */
  staleMs?: number;
}

/** Portable replacement for flock: exclusive-create lockfile with stale detection. */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const staleMs = options.staleMs ?? 60_000;
  await mkdirp(path.dirname(lockPath));
  const release = await acquire(lockPath, staleMs, timeoutMs);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquire(lockPath: string, staleMs: number, timeoutMs: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await fsp.open(lockPath, 'wx');
      await handle.write(`${process.pid} ${Date.now()}`);
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fsp.unlink(lockPath).catch(() => undefined);
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      if (await isStale(lockPath, staleMs)) {
        await fsp.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Could not acquire lock: ${lockPath}`);
      }
      await sleep(50);
    }
  }
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const content = await fsp.readFile(lockPath, 'utf8');
    const createdAt = Number.parseInt(content.trim().split(/\s+/)[1] ?? '', 10);
    if (Number.isNaN(createdAt)) return true;
    return Date.now() - createdAt > staleMs;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
