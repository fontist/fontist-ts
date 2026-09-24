import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { existsSync, promises as fsp } from 'node:fs';
import type { FontistContext } from '../context.js';
import { BinaryCallError, FontconfigFileNotFoundError, FontconfigNotFoundError } from '../errors/errors.js';

const FONTIST_FONTCONFIG_PATH = path.join('fontconfig', 'conf.d', '10-fontist.conf');

/** fc-cache integration; absent tooling degrades to a clear error, as in Ruby. */
export class Fontconfig {
  private readonly ctx: FontistContext;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
  }

  static async isAvailable(ctx: FontistContext): Promise<boolean> {
    return (await whichFcCache(ctx)) !== null;
  }

  /** Ruby Fontconfig.remove(options) static delegate. */
  static async remove(ctx: FontistContext, options: { force?: boolean } = {}): Promise<void> {
    await new Fontconfig(ctx).remove(options);
  }

  /** Refreshes the fontconfig cache; raises FontconfigNotFoundError when
   * fc-cache is missing, FontconfigFileNotFoundError when fonts.conf is
   * missing, and BinaryCallError when fc-cache fails. */
  async update(): Promise<void> {
    const fcCache = await requireFcCache(this.ctx);
    const fontsConf = this.fontsConfPath();
    if (fontsConf) {
      const { pathExists } = await import('../util/fsx.js');
      if (!(await pathExists(fontsConf))) {
        throw new FontconfigFileNotFoundError(`fontconfig configuration not found: ${fontsConf}`);
      }
    }
    await refreshCache(fcCache);
    this.ctx.ui.say('Fontconfig updated.');
  }

  /** Removes the fontist fontconfig include, refreshing the cache first
   * when the tooling is available (Ruby Fontconfig.remove). A missing file
   * raises FontconfigFileNotFoundError unless `force`. */
  async remove(options: { force?: boolean } = {}): Promise<void> {
    if (!existsSync(this.configPath())) {
      if (options.force) return;
      throw new FontconfigFileNotFoundError();
    }
    const fcCache = await whichFcCache(this.ctx);
    if (fcCache) {
      // best-effort cache refresh, guarded like Ruby's fontconfig_installed?
      await refreshCache(fcCache).catch(() => undefined);
    }
    await fsp.rm(this.configPath());
  }

  private configPath(): string {
    const xdg = this.ctx.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
    return path.join(xdg, FONTIST_FONTCONFIG_PATH);
  }

  private fontsConfPath(): string | null {
    const explicit = this.ctx.env.FONTCONFIG_FILE;
    if (explicit) return explicit;
    const xdg = this.ctx.env.XDG_CONFIG_HOME;
    if (xdg) return path.join(xdg, 'fontconfig', 'fonts.conf');
    return null;
  }
}

async function requireFcCache(ctx: FontistContext): Promise<string> {
  const fcCache = await whichFcCache(ctx);
  if (!fcCache) {
    throw new FontconfigNotFoundError(
      'fc-cache not found. Install fontconfig (e.g. `brew install fontconfig`) ' +
        'or run with --no-update-fontconfig.',
    );
  }
  return fcCache;
}

async function refreshCache(fcCache: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(fcCache, ['-f'], { stdio: 'ignore' });
    child.on('error', (err) => reject(new BinaryCallError(`fc-cache failed: ${String(err)}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new BinaryCallError(`fc-cache exited with ${code}`));
    });
  });
}

async function whichFcCache(ctx: FontistContext): Promise<string | null> {
  const paths = (ctx.env.PATH ?? '').split(path.delimiter);
  for (const dir of paths) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, 'fc-cache');
    try {
      await import('node:fs/promises').then((m) => m.access(candidate));
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}
