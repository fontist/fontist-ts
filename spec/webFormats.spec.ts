import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FontFile } from '../src/fonts/fontFile.js';
import { SfntFont } from '../src/fonts/sfnt/sfntFont.js';
import { assembleSfnt } from '../src/fonts/sfnt/assemble.js';
import { decodeWoff2, encodeWoff2 } from '../src/fonts/woff/woff2.js';
import { encodeWoff1, loadWoff1 } from '../src/fonts/woff/woff1.js';
import { defaultTranscoderRegistry } from '../src/installer/transcode.js';
import { makeTtf, tmpDir } from './helpers/index.js';

const FIXTURES = 'spec/fixtures/fonts';

describe('WOFF/WOFF2 decoding (reference fixtures from fontTools)', () => {
  for (const [file, format] of [
    ['fixture.woff', 'woff'],
    ['fixture.woff2', 'woff2'],
  ] as const) {
    it(`reads the ${format} fixture with full metadata`, () => {
      const font = FontFile.fromBytes(readFileSync(path.join(FIXTURES, file)), file);
      expect(font.format).toBe(format);
      expect(font.familyName).toBe('Fixture Sans');
      expect(font.subfamilyName).toBe('Regular');
      expect(font.fullName).toBe('Fixture Sans Regular');
      expect(font.postScriptName).toBe('FixtureSans-Regular');
    });
  }
});

describe('WOFF1 codec round-trips', () => {
  it('re-encodes a ttf and decodes to the same metadata', () => {
    const ttf = makeTtf({ family: 'Round W1', subfamily: 'Bold', fullName: 'Round W1 Bold' });
    const sfnt = new SfntFont(ttf);
    const tables = sfnt.tables().map((t) => ({ tag: t.tag, checksum: 0, data: t.data }));
    const encoded = encodeWoff1(tables, sfnt.flavor());
    expect(encoded.subarray(0, 4).toString('ascii')).toBe('wOFF');

    const decoded = loadWoff1(encoded);
    expect(decoded.familyName()).toBe('Round W1');
    expect(decoded.fullName()).toBe('Round W1 Bold');
    expect(decoded.flavor()).toBe(sfnt.flavor());
  });
});

describe('WOFF2 codec round-trips', () => {
  it('re-encodes a ttf and decodes to the same metadata', () => {
    const ttf = makeTtf({ family: 'Round W2', subfamily: 'Italic', fullName: 'Round W2 Italic' });
    const sfnt = new SfntFont(ttf);
    const tables = sfnt.tables().map((t) => ({ tag: t.tag, checksum: 0, data: t.data }));
    const encoded = encodeWoff2(tables, sfnt.flavor());
    expect(encoded.subarray(0, 4).toString('ascii')).toBe('wOF2');

    const decoded = decodeWoff2(encoded);
    expect(decoded.isVariable).toBe(false);
    const name = decoded.tables.find((t) => t.tag === 'name');
    expect(name).toBeTruthy();
    const font = new SfntFont(assembleSfnt(decoded.tables.map((t) => ({ ...t, checksum: 0 }))));
    expect(font.familyName()).toBe('Round W2');
    expect(font.fullName()).toBe('Round W2 Italic');
  });

  it('flags variable fonts from the directory alone', () => {
    const ttf = makeTtf({ family: 'Var W2' }, [{ tag: 'wght' }]);
    const sfnt = new SfntFont(ttf);
    const encoded = encodeWoff2(
      sfnt.tables().map((t) => ({ tag: t.tag, checksum: 0, data: t.data })),
      sfnt.flavor(),
    );
    expect(decodeWoff2(encoded).isVariable).toBe(true);
  });

  it('rejects truncated streams', () => {
    expect(() => decodeWoff2(Buffer.from('wOF2junk'))).toThrow(/truncated/);
  });
});

describe('WoffTranscoder', () => {
  it('converts ttf to woff and woff2, and is registered by default', async () => {
    const registry = defaultTranscoderRegistry();
    const source = path.join(await tmpDir(), 'source.ttf');
    await fsp.writeFile(source, makeTtf({ family: 'Transcoded', fullName: 'Transcoded Regular' }));

    for (const targetFormat of ['woff', 'woff2']) {
      const transcoder = registry.require('ttf', targetFormat);
      const converted = await transcoder.convert(source, targetFormat, {});
      const font = FontFile.fromBytes(readFileSync(converted), converted);
      expect(font.format).toBe(targetFormat);
      expect(font.familyName).toBe('Transcoded');
    }
  });

  it('refuses collections and unsupported directions', async () => {
    const registry = defaultTranscoderRegistry();
    expect(() => registry.require('ttc', 'woff2')).toThrow(/cannot be transcoded/);
    expect(() => registry.require('woff2', 'ttf')).toThrow(/desktop -> web/);
  });
});

