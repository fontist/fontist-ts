import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UI } from '../src/ui/ui.js';
import { Fontconfig } from '../src/fontconfig/fontconfig.js';
import { BinaryCallError, FontconfigNotFoundError } from '../src/errors/errors.js';
import { createContext } from '../src/context.js';

function capturingUi(tty = false): { ui: UI; lines: string[] } {
  const lines: string[] = [];
  const ui = new UI({
    out: { write: (text) => lines.push(text) },
    err: { write: (text) => lines.push(text) },
    tty,
  });
  return { ui, lines };
}

describe('UI', () => {
  it('captures say/error/warn output', () => {
    const { ui, lines } = capturingUi();
    ui.say('hello');
    ui.error('oops');
    ui.warn('careful');
    expect(lines.join('')).toBe('hello\noops\ncareful\n');
  });

  it('gates debug output behind the debug level', () => {
    const quiet = capturingUi();
    quiet.ui.debug('hidden');
    expect(quiet.lines).toEqual([]);

    const verbose = capturingUi();
    verbose.ui.setLevel('debug');
    verbose.ui.debug('shown');
    expect(verbose.lines.join('')).toContain('shown');
  });

  it('suppresses progress without a tty and renders it with one', () => {
    const headless = capturingUi(false);
    headless.ui.progress(0.5, 1, 2);
    expect(headless.lines).toEqual([]);

    const tty = capturingUi(true);
    tty.ui.progress(0.5, 1, 2);
    expect(tty.lines.join('')).toContain('Downloading: 50% (1.0/2.0 MiB)');
    tty.ui.clearProgressLine();
    tty.ui.say('after');
    expect(tty.lines.at(-1)).toBe('after\n');
  });
});

describe('Fontconfig', () => {
  it('raises FontconfigNotFoundError when fc-cache is missing', async () => {
    const { ui } = capturingUi();
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-fc-'));
    try {
      const ctx = await createContext(
        {
          PATH: path.join(home, 'empty-bin'),
        } as NodeJS.ProcessEnv,
        { ui, platform: 'macos' },
      );
      await expect(new Fontconfig(ctx).update()).rejects.toBeInstanceOf(FontconfigNotFoundError);
    } finally {
      await fsp.rm(home, { recursive: true, force: true });
    }
  });

  it('runs the fake fc-cache with -f and reports success', async () => {
    const { ui, lines } = capturingUi();
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-fc-'));
    const bin = path.join(home, 'bin');
    const marker = path.join(home, 'fc-cache-ran');
    await fsp.mkdir(bin, { recursive: true });
    const script = path.join(bin, 'fc-cache');
    await fsp.writeFile(script, `#!/bin/sh\ntouch "${marker}"\n`);
    await fsp.chmod(script, 0o755);
    try {
      const ctx = await createContext({ PATH: bin } as NodeJS.ProcessEnv, { ui, platform: 'macos' });
      await new Fontconfig(ctx).update();
      expect(await fsp.access(marker).then(() => true).catch(() => false)).toBe(true);
      expect(lines.join('')).toContain('Fontconfig updated');
    } finally {
      await fsp.rm(home, { recursive: true, force: true });
    }
  });

  it('raises BinaryCallError when fc-cache fails', async () => {
    const { ui } = capturingUi();
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-fc-'));
    const bin = path.join(home, 'bin');
    await fsp.mkdir(bin, { recursive: true });
    const script = path.join(bin, 'fc-cache');
    await fsp.writeFile(script, '#!/bin/sh\nexit 3\n');
    await fsp.chmod(script, 0o755);
    try {
      const ctx = await createContext({ PATH: bin } as NodeJS.ProcessEnv, { ui, platform: 'macos' });
      await expect(new Fontconfig(ctx).update()).rejects.toBeInstanceOf(BinaryCallError);
    } finally {
      await fsp.rm(home, { recursive: true, force: true });
    }
  });
});
