import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { BinaryCallError, FontconfigNotFoundError } from '../errors/errors.js';

/** fc-cache integration; absent tooling degrades to a clear error, as in Ruby. */
export class Fontconfig {
  private readonly ctx: FontistContext;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
  }

  static async isAvailable(ctx: FontistContext): Promise<boolean> {
    return (await whichFcCache(ctx)) !== null;
  }

  /** Refreshes the fontconfig cache; raises FontconfigNotFoundError when
   * fc-cache is missing, FontconfigFileNotFoundError when fonts.conf is
   * missing, and BinaryCallError when fc-cache fails. */
  async update(): Promise<void> {
    const fcCache = await whichFcCache(this.ctx);
    if (!fcCache) {
      throw new FontconfigNotFoundError(
        'fc-cache not found. Install fontconfig (e.g. `brew install fontconfig`) ' +
          'or run with --no-update-fontconfig.',
      );
    }
    const fontsConf = this.fontsConfPath();
    if (fontsConf) {
      const { pathExists } = await import('../util/fsx.js');
      if (!(await pathExists(fontsConf))) {
        throw new (await import('../errors/errors.js')).FontconfigFileNotFoundError(
          `fontconfig configuration not found: ${fontsConf}`,
        );
      }
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(fcCache, ['-f'], { stdio: 'ignore' });
      child.on('error', (err) => reject(new BinaryCallError(`fc-cache failed: ${String(err)}`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new BinaryCallError(`fc-cache exited with ${code}`));
      });
    });
    this.ctx.ui.say('Fontconfig updated.');
  }

  private fontsConfPath(): string | null {
    const explicit = this.ctx.env.FONTCONFIG_FILE;
    if (explicit) return explicit;
    const xdg = this.ctx.env.XDG_CONFIG_HOME;
    if (xdg) return path.join(xdg, 'fontconfig', 'fonts.conf');
    return null;
  }
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
