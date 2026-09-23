// Mirrors spec/fontist/import/otf/font_file_spec.rb and
// spec/fontist/import/macos_dfont_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportFontFile } from '../../src/import/otf/fontFile.js';
import { FontDetector } from '../../src/import/files/fontDetector.js';
import { UnknownFontTypeError } from '../../src/errors/errors.js';
import { makeDfont, makeTtf, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

describe('Import::Otf::FontFile', () => {
  let env: TestEnv;
  let dir: string;
  let fontPath: string;

  beforeAll(async () => {
    env = await testEnv();
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-otf-'));
    fontPath = path.join(dir, 'DejaVuSerif.ttf');
    await fsp.writeFile(
      fontPath,
      makeTtf({
        family: 'DejaVu Serif',
        subfamily: 'Book',
        fullName: 'DejaVu Serif Book',
        postScript: 'DejaVuSerif-Book',
        version: 'Version 2.37',
        copyright: 'Copyright (c) Bitstream',
        vendorUrl: 'https://dejavu-fonts.org/',
        licenseUrl: 'https://dejavu-fonts.org/wiki/License',
      }),
    );
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
    await cleanup(env);
  });

  it('initializes with a path', () => {
    const fontFile = new ImportFontFile(fontPath);
    expect(fontFile.path).toBe(fontPath);
  });

  it('accepts a name_prefix option', () => {
    const fontFile = new ImportFontFile(fontPath, { namePrefix: 'Custom ' });
    expect(fontFile.familyName.startsWith('Custom ')).toBe(true);
  });

  describe('#toStyle', () => {
    it('returns a hash with style attributes', () => {
      const style = new ImportFontFile(fontPath).toStyle();
      expect(Object.keys(style)).toEqual(
        expect.arrayContaining([
          'family_name',
          'type',
          'full_name',
          'post_script_name',
          'version',
          'copyright',
          'font',
        ]),
      );
    });

    it('includes font and excludes nil values', () => {
      const style = new ImportFontFile(fontPath).toStyle();
      expect(style['font']).toBe('DejaVuSerif.ttf');
      expect(Object.values(style)).not.toContain(null);
    });
  });

  describe('#toCollectionStyle', () => {
    it('excludes font and source_font', () => {
      const style = new ImportFontFile(fontPath).toCollectionStyle();
      expect(style).not.toHaveProperty('font');
      expect(style).not.toHaveProperty('source_font');
      expect(Object.keys(style)).toEqual(
        expect.arrayContaining(['family_name', 'type', 'full_name', 'post_script_name']),
      );
    });
  });

  describe('#family_name', () => {
    it('returns the family name without prefix', () => {
      expect(new ImportFontFile(fontPath).familyName).toBe('DejaVu Serif');
    });

    it('includes the prefix when provided', () => {
      expect(new ImportFontFile(fontPath, { namePrefix: 'Custom ' }).familyName).toBe(
        'Custom DejaVu Serif',
      );
    });

    it('falls back to the basename family with Regular type', async () => {
      const bad = path.join(dir, 'bad.ttf');
      await fsp.writeFile(bad, Buffer.from('junk data'));
      // no UI passed — the extraction warning stays silent
      const fontFile = new ImportFontFile(bad);
      expect(fontFile.familyName).toBe('bad');
      expect(fontFile.type).toBe('Regular');
    });
  });

  describe('#type', () => {
    it('returns the subfamily name', () => {
      expect(new ImportFontFile(fontPath).type).toBe('Book');
    });

    it('falls back to Regular type', async () => {
      const bad = path.join(dir, 'also-bad.ttf');
      await fsp.writeFile(bad, Buffer.from('junk data'));
      expect(new ImportFontFile(bad).type).toBe('Regular');
    });
  });

  it('exposes version, copyright, homepage, and license url', () => {
    const fontFile = new ImportFontFile(fontPath);
    expect(fontFile.version).toBe('2.37');
    expect(fontFile.copyright).toBe('Copyright (c) Bitstream');
    expect(fontFile.homepage).toBe('https://dejavu-fonts.org/');
    expect(fontFile.licenseUrl).toBe('https://dejavu-fonts.org/wiki/License');
  });
});

describe('FontDetector (dfont support)', () => {
  let dir: string;
  let dfontPath: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-dfont-'));
    dfontPath = path.join(dir, 'Tamsyn7x13.dfont');
    await fsp.writeFile(
      dfontPath,
      makeDfont([
        { family: 'Tamsyn7x13', subfamily: 'Regular', fullName: 'Tamsyn7x13' },
        { family: 'Tamsyn7x13 Bold', subfamily: 'Bold', fullName: 'Tamsyn7x13 Bold' },
      ]),
    );
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('detects .dfont as a collection file', async () => {
    expect(await FontDetector.detect(dfontPath)).toBe('collection');
  });

  it('preserves the .dfont extension', async () => {
    expect(await FontDetector.standardExtension(dfontPath)).toBe('dfont');
  });

  it('reads faces from the dfont', () => {
    const fontFile = new ImportFontFile(dfontPath);
    expect(fontFile.font.endsWith('.dfont')).toBe(true);
    expect(fontFile.familyName).toBe('Tamsyn7x13');
  });

  it('raises UnknownFontTypeError when the type cannot be detected', async () => {
    const junk = path.join(dir, 'junk.dat');
    await fsp.writeFile(junk, Buffer.from('not a font at all........'));
    await expect(FontDetector.standardExtension(junk)).rejects.toThrow(UnknownFontTypeError);
    expect(await FontDetector.detect(junk)).toBe('other');
  });
});
