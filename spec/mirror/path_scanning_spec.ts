// Mirrors spec/fontist/path_scanning_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFontPaths } from '../../src/system/pathScanning.js';
import { testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

describe('PathScanning', () => {
  it('returns an empty array for non-existent directories', async () => {
    const e = await env();
    expect(await scanFontPaths([path.join(e.home, 'nope')])).toEqual([]);
  });

  it('lists font files with full paths and supported extensions only', async () => {
    const e = await env();
    const dir = path.join(e.home, 'fonts');
    await fsp.mkdir(dir, { recursive: true });
    for (const name of ['a.ttf', 'B.OTF', 'c.ttc', 'notes.txt', '.secret.ttf']) {
      await fsp.writeFile(path.join(dir, name), 'x');
    }
    const found = await scanFontPaths([dir]);
    const names = found.map((p) => path.basename(p)).sort();
    expect(names).toEqual(['B.OTF', 'a.ttf', 'c.ttc']);
  });

  it('scans nested directories', async () => {
    const e = await env();
    const nested = path.join(e.home, 'fonts', 'sub');
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(nested, 'Deep.ttf'), 'x');
    const found = await scanFontPaths([e.home]);
    expect(found.some((p) => p.endsWith('Deep.ttf'))).toBe(true);
  });
});
