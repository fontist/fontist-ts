import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import {
  InvalidResourceError,
  TamperedFileError,
  TimeoutError,
} from '../errors/errors.js';
import { DownloadCache } from './downloadCache.js';
import {
  ApiGithubUrlResolver,
  browserHeaders,
  randomBrowserProfile,
  type GithubUrlResolver,
} from './userAgent.js';

export interface ResolvedDownloadUrl {
  url: string;
  headers: Record<string, string>;
}

export interface DownloadOptions {
  /** Accepted sha256 digests; when set, the downloaded file must match one. */
  sha256?: string[];
  /** Expected size in bytes, used for progress display. */
  fileSize?: number | null;
  progress?: boolean;
  useCache?: boolean;
}

export interface DownloadResult {
  path: string;
  fromCache: boolean;
}

const MAX_REDIRECTS = 10;
const MAX_ATTEMPTS = 3;

/** Downloads files through the Fontist cache with retries, browser headers,
 * and sha256 verification. */
export class Downloader {
  private readonly ctx: FontistContext;
  private readonly cache: DownloadCache;
  private readonly urlResolver: GithubUrlResolver;

  constructor(
    ctx: FontistContext,
    cache: DownloadCache | null = null,
    urlResolver: GithubUrlResolver | null = null,
  ) {
    this.ctx = ctx;
    this.cache = cache ?? new DownloadCache(ctx);
    this.urlResolver = urlResolver ?? new ApiGithubUrlResolver(ctx.env.GITHUB_API_TOKEN ?? null);
  }

  get downloadCache(): DownloadCache {
    return this.cache;
  }

  async download(url: string, options: DownloadOptions = {}): Promise<DownloadResult> {
    const useCache = options.useCache ?? this.ctx.runtime?.useCache ?? true;
    if (useCache) {
      const cached = await this.cache.get(url);
      if (cached) {
        if (options.sha256 && options.sha256.length > 0) {
          const ok = await sha256Matches(cached, options.sha256);
          if (!ok) {
            this.ctx.ui.debug(`Cached file ${cached} failed checksum; re-downloading`);
            await fsp.rm(path.dirname(cached), { recursive: true, force: true });
          } else {
            this.ctx.ui.say('Using cached file.');
            return { path: cached, fromCache: true };
          }
        } else {
          this.ctx.ui.say('Using cached file.');
          return { path: cached, fromCache: true };
        }
      }
    }

    const fetched = await this.fetchToCache(url, options);
    return { path: fetched, fromCache: false };
  }

  private async fetchToCache(url: string, options: DownloadOptions): Promise<string> {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-download-'));
    const tmpFile = path.join(tmpDir, 'file');
    try {
      await this.fetchWithRetries(url, tmpFile, options);
      if (options.sha256 && options.sha256.length > 0) {
        const ok = await sha256Matches(tmpFile, options.sha256);
        if (!ok) {
          throw new TamperedFileError(options.sha256.join(' or '));
        }
      }
      return await this.cache.put(url, tmpFile);
    } catch (err) {
      if (err instanceof TamperedFileError && this.ctx.config.get('continue_on_checksum_mismatch')) {
        this.ctx.ui.warn(`Checksum mismatch for ${url}, continuing per config.`);
        return await this.cache.put(url, tmpFile);
      }
      throw err;
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async fetchWithRetries(
    url: string,
    targetPath: string,
    options: DownloadOptions,
  ): Promise<void> {
    let lastError: Error = new InvalidResourceError(`Could not download ${url}`);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delaySeconds = Math.min(2 ** attempt, 30);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
      try {
        await this.fetchOnce(url, targetPath, options);
        return;
      } catch (err) {
        if (err instanceof TamperedFileError || err instanceof TimeoutError) throw err;
        lastError = err as Error;
        this.ctx.ui.debug(`Download attempt ${attempt + 1} failed: ${String(err)}`);
      }
    }
    throw lastError;
  }

  private async fetchOnce(
    rawUrl: string,
    targetPath: string,
    options: DownloadOptions,
  ): Promise<void> {
    let url = rawUrl;
    const headers: Record<string, string> = browserHeaders(randomBrowserProfile());
    const resolved = await this.urlResolver.resolve(rawUrl);
    if (resolved) {
      url = resolved.url;
      Object.assign(headers, resolved.headers);
    }
    const openTimeout = this.ctx.config.get('open_timeout') ?? 60;
    const readTimeout = this.ctx.config.get('read_timeout') ?? 60;

    let response: Response;
    try {
      response = await fetchWithRedirects(url, headers, MAX_REDIRECTS, openTimeout * 1000);
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      throw new InvalidResourceError(`Could not download ${rawUrl}: ${String(err)}`);
    }
    if (!response.ok || response.body === null) {
      throw new InvalidResourceError(`Could not download ${rawUrl}: HTTP ${response.status}`);
    }

    const total = options.fileSize ?? contentLength(response);
    const started = Date.now();
    let received = 0;
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    const readTimeoutMs = readTimeout * 1000;
    for (;;) {
      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await withTimeout(reader.read(), readTimeoutMs, rawUrl);
      } catch (err) {
        await reader.cancel().catch(() => undefined);
        throw err;
      }
      if (result.done || result.value === undefined) break;
      chunks.push(Buffer.from(result.value));
      received += result.value.byteLength;
      if (options.progress ?? false) {
        this.reportProgress(received, total, started);
      }
    }

    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      throw new InvalidResourceError(`Empty response from ${rawUrl}`);
    }
    await fsp.writeFile(targetPath, buffer);
  }

  private reportProgress(received: number, total: number | null, started: number): void {
    const receivedMiB = received / (1024 * 1024);
    const totalMiB = total === null ? null : total / (1024 * 1024);
    const elapsed = (Date.now() - started) / 1000;
    const bytesPerSecond = elapsed > 0 ? received / elapsed : 0;
    const ratio = total !== null && total > 0 ? received / total : 0;
    const eta =
      total !== null && bytesPerSecond > 0
        ? Math.max(0, Math.round((total - received) / bytesPerSecond))
        : null;
    this.ctx.ui.progress(ratio, receivedMiB, totalMiB);
    if (eta !== null) {
      this.ctx.ui.debug(`ETA: ${eta}s`);
    }
  }
}

async function fetchWithRedirects(
  url: string,
  headers: Record<string, string>,
  remainingRedirects: number,
  timeoutMs: number,
): Promise<Response> {
  const response = await withTimeout(fetch(url, { headers, redirect: 'manual' }), timeoutMs, url);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location && remainingRedirects > 0) {
      return fetchWithRedirects(new URL(location, url).toString(), headers, remainingRedirects - 1, timeoutMs);
    }
  }
  return response;
}

function contentLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (!header) return null;
  const value = Number.parseInt(header, 10);
  return Number.isNaN(value) ? null : value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`Timed out reading ${url}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sha256Matches(filePath: string, accepted: string[]): Promise<boolean> {
  const { sha256File } = await import('../util/fsx.js');
  const digest = await sha256File(filePath);
  return accepted.includes(digest);
}

export function sha256OfBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
