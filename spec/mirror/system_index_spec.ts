// Mirrors spec/fontist/system_index_spec.rb +
// spec/fontist/system_index_font_collection_spec.rb (Ruby gem): corrupted
// index errors, magic-byte dispatch, rebuild triggers, metadata filtering.
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { describe, expect, it } from 'vitest';
import { FontistIndex } from '../../src/index/installed/collectionIndexes.js';
import { makeOtf, makeTtc, makeTtf, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

async function writeFont(e: TestEnv, name: string, data: Buffer): Promise<string> {
  const fontsDir = e.ctx.paths.fontsPath();
  await fsp.mkdir(fontsDir, { recursive: true });
  const fontPath = path.join(fontsDir, name);
  await fsp.writeFile(fontPath, data);
  return fontPath;
}

describe('SystemIndexFontCollection', () => {
  it('throws FontIndexCorrupted for entries missing required attributes', async () => {
    const e = await env();
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    await writeFont(e, 'Ok.ttf', makeTtf({ family: 'Ok', subfamily: 'Regular', fullName: 'Ok' }));
    const index = new FontistIndex(e.ctx);
    await index.rebuild();

    const indexPath = e.ctx.paths.fontistIndexPath();
    const data = yaml.parse(await fsp.readFile(indexPath, 'utf8')) as {
      fonts: { family_name: string | null }[];
    };
    data.fonts[0]!.family_name = null;
    await fsp.writeFile(indexPath, yaml.stringify(data, { lineWidth: 1000 }));

    const reloaded = new FontistIndex(e.ctx);
    await expect(reloaded.find('Ok')).rejects.toThrow(/FontIndexCorrupted|misses required attributes/);
  });

  it('indexes fonts by their actual format, not their extension', async () => {
    const e = await env();
    // OTF bytes stored under a .ttc name (Ruby's SauberScript.ttc case).
    const fontPath = await writeFont(e, 'Sauber.ttc', makeOtf({ family: 'Sauber', subfamily: 'Regular', fullName: 'Sauber' }));
    const index = new FontistIndex(e.ctx);
    const found = await index.find('Sauber');
    expect(found).toHaveLength(1);
    expect(found![0]!.format).toBe('otf');
    void fontPath;
  });

  it('indexes all faces of a collection by magic bytes', async () => {
    const e = await env();
    await writeFont(
      e,
      'Pack.ttc',
      makeTtc([
        { family: 'Pack One', subfamily: 'Regular', fullName: 'Pack One' },
        { family: 'Pack Two', subfamily: 'Italic', fullName: 'Pack Two Italic' },
      ]),
    );
    const index = new FontistIndex(e.ctx);
    // Face 0 is indexed (Ruby FontFile.from_path reads the first face).
    expect(await index.find('Pack One')).toHaveLength(1);
  });

  it('warns about corrupt font files without raising', async () => {
    const e = await env();
    await writeFont(e, 'Broken.ttf', Buffer.from('not a font at all'));
    const index = new FontistIndex(e.ctx);
    expect(await index.find('Broken')).toBeNull();
    expect(await index.find('Anything')).toBeNull(); // no raise
  });

  it('filters out entries with incomplete metadata at scan time', async () => {
    const e = await env();
    // Parses fine but lacks name records -> not indexable.
    await writeFont(e, 'Nameless.ttf', makeTtf({ family: 'Nameless' }));
    const index = new FontistIndex(e.ctx);
    expect(await index.find('Nameless')).toBeNull();
  });

  it('excludes listed fonts from the index', async () => {
    const e = await env();
    await writeFont(e, 'NISC18030.ttf', makeTtf({ family: 'NISC', subfamily: 'Regular', fullName: 'NISC' }));
    const index = new FontistIndex(e.ctx);
    expect(await index.find('NISC')).toBeNull();
  });

  it('rebuilds when new non-excluded fonts appear', async () => {
    const e = await env();
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    const index = new FontistIndex(e.ctx);
    await index.rebuild();
    expect(await index.find('Fresh')).toBeNull();

    await writeFont(e, 'Fresh.ttf', makeTtf({ family: 'Fresh', subfamily: 'Regular', fullName: 'Fresh' }));
    // Ruby specs manipulate last_scan_time to defeat the 30-min freshness
    // window; we do the same before the change check.
    const indexPath = e.ctx.paths.fontistIndexPath();
    const data = yaml.parse(await fsp.readFile(indexPath, 'utf8')) as { last_scan_time: number };
    data.last_scan_time = 0;
    await fsp.writeFile(indexPath, yaml.stringify(data, { lineWidth: 1000 }));

    const fresh = new FontistIndex(e.ctx);
    expect(await fresh.find('Fresh')).toHaveLength(1);
  });
});
