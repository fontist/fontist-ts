// Mirrors spec/fontist/import/google/metadata_adapter_spec.rb (Ruby gem).
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTextproto } from '../../src/import/google/textproto.js';
import { MetadataAdapter } from '../../src/import/google/metadataAdapter.js';
import { Metadata } from '../../src/import/google/models/metadata.js';

const FIXTURES = path.join(__dirname, '..', '..', 'spec', 'fixtures', 'google_fonts');

function adapt(relative: string): Metadata {
  const content = readFileSync(path.join(FIXTURES, relative, 'METADATA.pb'), 'utf8');
  const message = parseTextproto(content);
  return MetadataAdapter.adapt(message);
}

describe('Google::MetadataAdapter', () => {
  describe('with simple font (ABeeZee)', () => {
    const metadata = () => adapt('abeezee');

    it('converts to the Metadata model', () => {
      expect(metadata()).toBeInstanceOf(Metadata);
    });

    it('extracts basic fields', () => {
      expect(metadata().name).toBe('ABeeZee');
      expect(metadata().designer).toBe('Anja Meiners');
      expect(metadata().license).toBe('OFL');
      expect(metadata().category).toBe('SANS_SERIF');
      expect(metadata().dateAdded).toBe('2012-09-30');
    });

    it('extracts font files', () => {
      expect(metadata().fontCount()).toBe(2);
      expect(metadata().regularFont()).not.toBeNull();
      expect(metadata().regularFont()!.filename).toBe('ABeeZee-Regular.ttf');
    });

    it('extracts subsets', () => {
      expect(metadata().subsets).toEqual(expect.arrayContaining(['latin', 'latin-ext', 'menu']));
    });

    it('extracts source information', () => {
      expect(metadata().source).not.toBeNull();
      expect(metadata().source!.repositoryUrl).toBe('https://github.com/googlefonts/abeezee');
    });

    it('has no axes (static font)', () => {
      expect(metadata().variableFont()).toBe(false);
      expect(metadata().axisCount()).toBe(0);
    });
  });

  describe('with variable font (Alexandria)', () => {
    const metadata = () => adapt('alexandria');

    it('extracts variable font axes', () => {
      expect(metadata().variableFont()).toBe(true);
      expect(metadata().axisCount()).toBe(1);
      expect(metadata().axisTags()).toEqual(['wght']);
    });

    it('extracts axis details', () => {
      const wghtAxis = metadata().weightAxis();
      expect(wghtAxis).not.toBeNull();
      expect(wghtAxis!.minValue).toBe(100);
      expect(wghtAxis!.maxValue).toBe(900);
    });

    it('extracts primary_script', () => {
      expect(metadata().primaryScript).toBe('Arab');
    });
  });

  describe('with complex variable font (Roboto Flex)', () => {
    const metadata = () => adapt('robotoflex');

    it('extracts all 13 axes', () => {
      expect(metadata().axisCount()).toBe(13);
      expect(metadata().axisTags()).toEqual(
        expect.arrayContaining([
          'GRAD', 'XOPQ', 'XTRA', 'YOPQ', 'YTAS', 'YTDE', 'YTFI', 'YTLC', 'YTUC', 'opsz', 'slnt', 'wdth', 'wght',
        ]),
      );
    });

    it('extracts registry_default_overrides correctly', () => {
      expect(metadata().hasRegistryOverrides()).toBe(true);
      expect(metadata().registryOverride('XOPQ')).toBe(96);
      expect(metadata().registryOverride('YTDE')).toBe(-203);
      expect(metadata().registryOverride('XTRA')).toBe(468);
    });

    it('extracts source with archive_url', () => {
      expect(metadata().source!.archiveUrl).toBe(
        'https://github.com/googlefonts/roboto-flex/releases/download/3.200/roboto-flex-fonts.zip',
      );
    });
  });

  describe('with large file (Noto Sans)', () => {
    const metadata = () => adapt('notosans');

    it('extracts multiple font files', () => {
      expect(metadata().fontCount()).toBe(2);
      expect(metadata().hasItalics()).toBe(true);
    });

    it('extracts many languages', () => {
      expect(metadata().languageCount()).toBeGreaterThan(800);
      expect(metadata().languages).toContain('aa_Latn');
    });

    it('identifies as Noto font', () => {
      expect(metadata().notoFont()).toBe(true);
    });
  });
});
