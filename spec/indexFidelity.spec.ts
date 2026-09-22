import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { Font } from '../src/api/font.js';
import { FontPath } from '../src/fonts/fontPath.js';
import { FontistIndex } from '../src/index/installed/collectionIndexes.js';
import { SystemFont } from '../src/system/systemFont.js';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import {
  cleanup,
  makeTtf,
  testEnv,
  writeFormula,
  type TestEnv,
} from './helpers/index.js';

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

async function installFixtureFont(e: TestEnv, names: { family: string; subfamily: string; fullName: string }): Promise<string> {
  const formulaKey = names.family.toLowerCase().replace(/ /g, '_');
  await writeFormula(e, formulaKey, {
    name: `${names.family} Formula`,
    fonts: [
      {
        name: names.family,
        styles: [
          {
            family_name: names.family,
            type: names.subfamily,
            full_name: names.fullName,
            post_script_name: `${names.family.replace(/ /g, '')}-${names.subfamily}`,
            font: `${names.fullName}.ttf`,
          },
        ],
      },
    ],
    resources: { 'f.zip': { urls: [`https://example.invalid/${formulaKey}.zip`] } },
  });
  const fontsDir = e.ctx.paths.fontsPath();
  await fsp.mkdir(path.join(fontsDir, formulaKey), { recursive: true });
  const fontPath = path.join(fontsDir, formulaKey, `${names.fullName}.ttf`);
  await fsp.writeFile(fontPath, makeTtf(names));
  const index = new FontistIndex(e.ctx);
  await index.addFont(fontPath);
  return fontPath;
}

describe('Installed-index fidelity (Ruby system_index semantics)', () => {
  it('find matches family names only; full names are stored but never matched', async () => {
    const e = await env();
    const fontPath = await installFixtureFont(e, {
      family: 'Sem Fidelity',
      subfamily: 'Regular',
      fullName: 'Sem Fidelity Regular Full',
    });
    const index = new FontistIndex(e.ctx);
    expect(await index.find('sem fidelity')).toHaveLength(1);
    expect(await index.find('Sem Fidelity Regular Full')).toBeNull();
    expect(await index.find('Sem Fidelity', 'regular')).toHaveLength(1);
    expect(await index.find('Sem Fidelity', 'Bold')).toBeNull();

    const entry = (await index.find('Sem Fidelity'))![0]!;
    expect(entry.fullName).toBe('Sem Fidelity Regular Full');
    expect(entry.path).toBe(fontPath);
  });

  it('empty indexes are always stale, bounded by the adoption window', async () => {
    const e = await env();
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    const index = new FontistIndex(e.ctx);
    expect(await index.find('Nothing')).toBeNull();

    await fsp.writeFile(
      path.join(fontsDir, 'Late.ttf'),
      makeTtf({ family: 'Late', subfamily: 'Regular', fullName: 'Late Regular' }),
    );
    // Ruby rebuild_with_lock adopts any index scanned <60s ago — including
    // an empty one — so the late font is not visible yet (parity behavior).
    expect(await index.find('Late')).toBeNull();

    // Defeating the adoption window (stale last_scan_time) forces the rescan.
    const indexPath = e.ctx.paths.fontistIndexPath();
    const yamlMod = await import('yaml');
    const data = yamlMod.parse(await fsp.readFile(indexPath, 'utf8')) as { last_scan_time: number };
    data.last_scan_time = 0;
    await fsp.writeFile(indexPath, yamlMod.stringify(data, { lineWidth: 1000 }));
    expect(await index.find('Late')).toHaveLength(1);
  });

  it('raises FontIndexCorrupted with missing keys for tampered entries', async () => {
    const e = await env();
    await installFixtureFont(e, { family: 'Tampered', subfamily: 'Regular', fullName: 'Tampered Regular' });
    const indexPath = e.ctx.paths.fontistIndexPath();
    const data = yaml.parse(await fsp.readFile(indexPath, 'utf8')) as {
      fonts: { full_name: string | null }[];
    };
    data.fonts[0]!.full_name = null;
    await fsp.writeFile(indexPath, yaml.stringify(data, { lineWidth: 1000 }));

    const index = new FontistIndex(e.ctx);
    await expect(index.find('Tampered')).rejects.toThrow(/misses required attributes: full_name/);
  });

  it('adopts an on-disk index rebuilt within the adoption window', async () => {
    const e = await env();
    const fontPath = await installFixtureFont(e, {
      family: 'Adopted',
      subfamily: 'Regular',
      fullName: 'Adopted Regular',
    });
    await fsp.rm(fontPath); // remove the real file: a rescan would drop the entry

    const index = new FontistIndex(e.ctx);
    e.ui.setLevel('debug');
    await index.rebuild({ forced: true }); // within 60s of the install-time scan
    const adopted = await index.find('Adopted');
    expect(adopted).toHaveLength(1); // adopted, not rescanned
    expect(e.ui.lines.join('\n')).toContain('Index recently rebuilt by another process');
  });

  it('read-only mode skips change detection', async () => {
    const e = await env();
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    await fsp.writeFile(
      path.join(fontsDir, 'First.ttf'),
      makeTtf({ family: 'First', subfamily: 'Regular', fullName: 'First Regular' }),
    );
    const index = new FontistIndex(e.ctx);
    await index.readOnlyMode();
    expect(await index.find('First')).toHaveLength(1);

    await fsp.writeFile(
      path.join(fontsDir, 'Second.ttf'),
      makeTtf({ family: 'Second', subfamily: 'Regular', fullName: 'Second Regular' }),
    );
    expect(await index.find('Second')).toBeNull(); // no rebuild in read-only
  });

  it('memoizes find_styles results per (name, style)', async () => {
    const e = await env();
    const fontPath = await installFixtureFont(e, {
      family: 'Memo',
      subfamily: 'Regular',
      fullName: 'Memo Regular',
    });
    const systemFont = new SystemFont(e.ctx).enableFindStylesCache();
    const first = await systemFont.findStyles('Memo');
    expect(first).toHaveLength(1);
    await fsp.rm(fontPath);
    const second = await systemFont.findStyles('Memo');
    expect(second).toBe(first); // cached identity, like Ruby's dup'd cache entry
    systemFont.resetFindStylesCache();
    // The installed index is still within its freshness window, so the
    // entry remains visible after the cache reset (Ruby parity).
    expect(await systemFont.findStyles('Memo')).toHaveLength(1);
  });
});

describe('FontPath rendering (Ruby font_path.rb)', () => {
  it('decorates fontist-managed fonts with providing formula names', async () => {
    const e = await env();
    const fontPath = await installFixtureFont(e, {
      family: 'Deco',
      subfamily: 'Regular',
      fullName: 'Deco Regular',
    });
    const rendered = await new FontPath(fontPath, e.ctx).toString();
    expect(rendered).toBe(`- ${fontPath} (from Deco Formula formula)`);
  });

  it('renders plain non-fontist paths undecorated', async () => {
    const e = await env();
    const outside = path.join(e.home, 'elsewhere', 'X.ttf');
    const rendered = await new FontPath(outside, e.ctx).toString();
    expect(rendered).toBe(`- ${outside}`);
  });

  it('find output uses FontPath decoration', async () => {
    const e = await env();
    const fontPath = await installFixtureFont(e, {
      family: 'FindDeco',
      subfamily: 'Regular',
      fullName: 'FindDeco Regular',
    });
    await Font.find('FindDeco', e.ctx);
    const output = e.ui.lines.join('\n');
    expect(output).toContain('- ');
    expect(output).toContain('(from FindDeco Formula formula)');
    expect(output).toContain(fontPath);
  });
});

describe('Font.all and findByFontFile', () => {
  it('Font.all returns fonts across supported formulas', async () => {
    const e = await env();
    await installFixtureFont(e, { family: 'AllFonts', subfamily: 'Regular', fullName: 'AllFonts Regular' });
    const fonts = await Font.all(e.ctx);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.name).toBe('AllFonts');
    expect(fonts[0]!.styles[0]!.font).toBe('AllFonts Regular.ttf');
  });

  it('findByFontFile resolves via the filename index', async () => {
    const e = await env();
    await installFixtureFont(e, { family: 'ByFile', subfamily: 'Regular', fullName: 'ByFile Regular' });
    const repository = new FormulaRepository(e.ctx);
    const formula = await repository.findByFontFile('/anywhere/ByFile Regular.ttf');
    expect(formula?.key()).toBe('byfile');
    expect(await repository.findByFontFile('/anywhere/Missing.ttf')).toBeNull();
  });
});
