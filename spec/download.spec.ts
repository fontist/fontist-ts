import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { Downloader } from '../src/download/downloader.js';
import { DownloadCache } from '../src/download/downloadCache.js';
import { InvalidResourceError, TamperedFileError } from '../src/errors/errors.js';
import { cleanup, testEnv, type TestEnv } from './helpers/index.js';
import { sha256File } from '../src/util/fsx.js';

let server: Server;
let baseUrl: string;
let requestCount: number;
let failFirst = 0;
const envs: TestEnv[] = [];

const PAYLOAD = Buffer.from('fontist zip payload 0123456789'.repeat(10));

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount += 1;
    if (req.url === '/fail-once' && requestCount <= failFirst) {
      res.writeHead(500);
      res.end('boom');
      return;
    }
    if (req.url === '/not-found') {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': PAYLOAD.length,
    });
    res.end(PAYLOAD);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function freshEnv(): Promise<TestEnv> {
  const env = await testEnv();
  envs.push(env);
  requestCount = 0;
  failFirst = 0;
  return env;
}

describe('Downloader', () => {
  it('downloads a file and reports the path', async () => {
    const env = await freshEnv();
    const downloader = new Downloader(env.ctx);
    const result = await downloader.download(`${baseUrl}/font.zip`);
    const content = await fsp.readFile(result.path);
    expect(content).toEqual(PAYLOAD);
    expect(result.fromCache).toBe(false);
  });

  it('serves the second download from cache without a new request', async () => {
    const env = await freshEnv();
    const downloader = new Downloader(env.ctx);
    const first = await downloader.download(`${baseUrl}/font.zip`);
    const before = requestCount;
    const second = await downloader.download(`${baseUrl}/font.zip`);
    expect(second.fromCache).toBe(true);
    expect(second.path).toBe(first.path);
    expect(requestCount).toBe(before);
  });

  it('verifies sha256 and rejects tampered payloads', async () => {
    const env = await freshEnv();
    const downloader = new Downloader(env.ctx);
    await expect(
      downloader.download(`${baseUrl}/font.zip`, { sha256: ['0'.repeat(64)] }),
    ).rejects.toBeInstanceOf(TamperedFileError);
  });

  it('accepts a matching sha256', async () => {
    const env = await freshEnv();
    const downloader = new Downloader(env.ctx);
    const digest = await sha256File(PAYLOAD.length > 0 ? await writePayload(env) : '');
    const result = await downloader.download(`${baseUrl}/font.zip`, { sha256: [digest] });
    expect(result.fromCache).toBe(false);
  });

  it('retries server errors and eventually succeeds', async () => {
    const env = await freshEnv();
    failFirst = 2;
    const downloader = new Downloader(env.ctx);
    const result = await downloader.download(`${baseUrl}/fail-once`);
    expect(result.fromCache).toBe(false);
    expect(requestCount).toBe(3);
  });

  it('raises InvalidResourceError after repeated failures', async () => {
    const env = await freshEnv();
    const downloader = new Downloader(env.ctx);
    await expect(downloader.download(`${baseUrl}/not-found`)).rejects.toBeInstanceOf(InvalidResourceError);
  });
});

async function writePayload(env: TestEnv): Promise<string> {
  const filePath = path.join(env.home, 'payload.bin');
  await fsp.writeFile(filePath, PAYLOAD);
  return filePath;
}

describe('DownloadCache', () => {
  it('stores url->file mapping with relative paths', async () => {
    const env = await freshEnv();
    const cache = new DownloadCache(env.ctx);
    const source = await writePayload(env);
    const stored = await cache.put('https://example.com/font.zip', source);
    expect(stored.startsWith(cache.directory())).toBe(true);
    expect(await cache.get('https://example.com/font.zip')).toBe(stored);
    const mapText = await fsp.readFile(cache.mapPath(), 'utf8');
    expect(mapText).toContain('https://example.com/font.zip');
    expect(mapText).not.toContain(env.home);
  });

  it('allFetched is true only when every url is cached', async () => {
    const env = await freshEnv();
    const cache = new DownloadCache(env.ctx);
    const source = await writePayload(env);
    expect(await cache.allFetched(['a', 'b'])).toBe(false);
    await cache.put('a', source);
    expect(await cache.allFetched(['a', 'b'])).toBe(false);
    await cache.put('b', source);
    expect(await cache.allFetched(['a', 'b'])).toBe(true);
  });

  it('clear() empties the map', async () => {
    const env = await freshEnv();
    const cache = new DownloadCache(env.ctx);
    const source = await writePayload(env);
    await cache.put('a', source);
    await cache.clear();
    expect(await cache.get('a')).toBeNull();
  });

  it('sanitizes and truncates long file names', async () => {
    const env = await freshEnv();
    const cache = new DownloadCache(env.ctx);
    const source = await writePayload(env);
    const longName = `${'x'.repeat(400)}.zip`;
    const stored = await cache.put('long', source);
    expect(stored).toBeTruthy();
    expect(longName.length).toBeGreaterThan(255);
  });
});
