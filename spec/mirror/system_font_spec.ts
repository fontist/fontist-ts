// Mirrors spec/fontist/system_font_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SystemFont } from '../../src/system/systemFont.js';
import { makeOtf, makeTtf, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  const fontsDir = e.ctx.paths.fontsPath();
  await fsp.mkdir(fontsDir, { recursive: true });
  await fsp.writeFile(
    path.join(fontsDir, 'SysSans.ttf'),
    makeTtf({ family: 'Sys Sans', subfamily: 'Regular', fullName: 'Sys Sans Regular' }),
  );
  await fsp.writeFile(
    path.join(fontsDir, 'SysSansBold.ttf'),
    makeTtf({ family: 'Sys Sans', subfamily: 'Bold', fullName: 'Sys Sans Bold' }),
  );
  return e;
}

describe('SystemFont.find', () => {
  it('returns the complete font paths', async () => {
    const e = await env();
    const paths = await new SystemFont(e.ctx).find('Sys Sans');
    expect(paths).toHaveLength(2);
    expect(paths!.every((p) => p.endsWith('.ttf'))).toBe(true);
  });

  it('returns nil to the caller for absent fonts', async () => {
    const e = await env();
    expect(await new SystemFont(e.ctx).find('Absent Font')).toBeNull();
  });

  it('returns only the requested style', async () => {
    const e = await env();
    const styles = await new SystemFont(e.ctx).findStyles('Sys Sans', 'Bold');
    expect(styles).toHaveLength(1);
    expect(styles![0]!.subfamily).toBe('Bold');
  });
});

describe('system.yml pattern data', () => {
  it('parses the macOS patterns with per-line extension sets', async () => {
    const { systemFontPatterns } = await import('../../src/system/systemFontsData.js');
    const patterns = systemFontPatterns('macos');
    const fonts = patterns.find((p) => p.base === '/Library/Fonts');
    expect(fonts).toBeDefined();
    expect(fonts!.extensions).toEqual(['ttf', 'ttc']);

    const assets = patterns.find((p) => p.base.includes('com_apple_MobileAsset_Font'));
    expect(assets!.extensions).toEqual(['ttf', 'ttc', 'otf', 'otc']);
    expect(assets!.literalBase).toBe('/System/Library/AssetsV2');
  });

  it('scans targets with per-pattern extension filtering', async () => {
    const { scanFontTargets } = await import('../../src/system/pathScanning.js');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-scan-ext-'));
    try {
      await fsp.writeFile(path.join(dir, 'Regular.ttf'), makeTtf({ family: 'T', subfamily: 'R' }));
      await fsp.writeFile(path.join(dir, 'Book.otf'), makeOtf({ family: 'T', subfamily: 'R' }));
      const ttfOnly = await scanFontTargets([{ dir, extensions: ['ttf'] }]);
      expect(ttfOnly.map((f) => path.basename(f))).toEqual(['Regular.ttf']);
      const all = await scanFontTargets([{ dir }]);
      expect(all).toHaveLength(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('memoizes scan targets per platform until reset', async () => {
    const { systemFontScanTargets, resetSystemFontPathsCache } = await import('../../src/system/systemFontsData.js');
    const ctx = { config: null, paths: null, ui: null, env: {}, platform: 'macos', runtime: {} };
    const first = await systemFontScanTargets(ctx as never);
    const second = await systemFontScanTargets(ctx as never);
    expect(second).toBe(first); // same array reference = memoized
    resetSystemFontPathsCache();
    const third = await systemFontScanTargets(ctx as never);
    expect(third).not.toBe(first);
  });
});
