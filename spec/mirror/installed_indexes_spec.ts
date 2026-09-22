// Mirrors spec/fontist/indexes/fontist_index_spec.rb, spec/fontist/indexes/user_index_spec.rb, spec/fontist/indexes/system_index_spec.rb (Ruby gem): per-scope installed-font index behavior.
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FontistIndex, SystemIndex, UserIndex } from '../../src/index/installed/collectionIndexes.js';
import { systemTemplateBaseDirs } from '../../src/system/systemFontsData.js';
import { cleanup, makeTtf, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

async function writeFont(e: TestEnv, dir: string, name: string, family: string): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  const fontPath = path.join(dir, name);
  await fsp.writeFile(fontPath, makeTtf({ family, subfamily: 'Regular', fullName: family }));
  return fontPath;
}

describe('FontistIndex', () => {
  it('tracks fonts under the fontist fonts directory', async () => {
    const e = await env();
    const fontPath = await writeFont(e, e.ctx.paths.fontsPath(), 'Mine.ttf', 'Mine');
    const index = new FontistIndex(e.ctx);
    const found = await index.find('mine');
    expect(found).toHaveLength(1);
    expect(found![0]!.path).toBe(fontPath);
  });
});

describe('UserIndex', () => {
  it('tracks fonts in the platform user font directory', async () => {
    const e = await env();
    const userDir = path.join(e.home, 'user-fonts');
    await writeFont(e, userDir, 'UserFont.ttf', 'User Font');
    const index = new UserIndex(e.ctx, userDir);
    expect(await index.find('user font')).toHaveLength(1);
  });
});

describe('SystemIndex', () => {
  it('monitors the configured system template base directories', async () => {
    const e = await env();
    const dirs = await systemTemplateBaseDirs(e.ctx);
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.every((d) => path.isAbsolute(d) || d.startsWith('C:'))).toBe(true);
  });

  it('find over an absent font resolves without raising', async () => {
    const e = await env();
    const index = new SystemIndex(e.ctx);
    expect((await index.find('Definitely Not Installed Font')) ?? []).toHaveLength(0);
  });
});
