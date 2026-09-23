// Mirrors spec/fontist/import/models/font_metadata_spec.rb and
// spec/fontist/import/font_metadata_extractor_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FontMetadata } from '../../src/import/models/fontMetadata.js';
import { FontMetadataExtractor } from '../../src/import/fontMetadataExtractor.js';
import { FontExtractError } from '../../src/errors/errors.js';
import { makeOtf, makeTtf, makeTtc, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

describe('Import::Models::FontMetadata', () => {
  it('creates instance with all attributes', () => {
    const metadata = new FontMetadata({
      family_name: 'Test Family',
      subfamily_name: 'Regular',
      full_name: 'Test Family Regular',
      postscript_name: 'TestFamily-Regular',
      preferred_family_name: 'Test',
      preferred_subfamily_name: 'Book',
      version: '1.0.0',
      copyright: 'Copyright (c) 2024',
      description: 'Test description',
      vendor_url: 'https://example.com',
      license_url: 'https://example.com/license',
      font_format: 'truetype',
      is_variable: false,
    });

    expect(metadata.familyName).toBe('Test Family');
    expect(metadata.subfamilyName).toBe('Regular');
    expect(metadata.fullName).toBe('Test Family Regular');
    expect(metadata.postscriptName).toBe('TestFamily-Regular');
    expect(metadata.preferredFamilyName).toBe('Test');
    expect(metadata.preferredSubfamilyName).toBe('Book');
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.copyright).toBe('Copyright (c) 2024');
    expect(metadata.description).toBe('Test description');
    expect(metadata.vendorUrl).toBe('https://example.com');
    expect(metadata.licenseUrl).toBe('https://example.com/license');
    expect(metadata.fontFormat).toBe('truetype');
    expect(metadata.isVariable).toBe(false);
  });

  it('handles nil values gracefully', () => {
    const metadata = new FontMetadata({
      family_name: 'Test Family',
      subfamily_name: 'Regular',
    });

    expect(metadata.familyName).toBe('Test Family');
    expect(metadata.subfamilyName).toBe('Regular');
    expect(metadata.preferredFamilyName).toBeNull();
    expect(metadata.version).toBeNull();
    expect(metadata.description).toBeNull();
  });

  it('serializes and deserializes through the framework', () => {
    const metadata = new FontMetadata({
      family_name: 'Test Family',
      subfamily_name: 'Regular',
      full_name: 'Test Family Regular',
      version: '1.0.0',
      is_variable: true,
    });

    const parsed = JSON.parse(JSON.stringify(metadata.toYamlObject()));
    expect(parsed['family_name']).toBe('Test Family');
    expect(parsed['is_variable']).toBe(true);

    const restored = FontMetadata.fromYamlObject(parsed) as FontMetadata;
    expect(restored.familyName).toBe('Test Family');
    expect(restored.version).toBe('1.0.0');
    expect(restored.isVariable).toBe(true);
  });
});

describe('FontMetadataExtractor', () => {
  let env: TestEnv;
  let dir: string;
  let ttfPath: string;
  let otfPath: string;
  let ttcPath: string;

  beforeAll(async () => {
    env = await testEnv();
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-extract-'));
    ttfPath = path.join(dir, 'TestSerif.ttf');
    otfPath = path.join(dir, 'testserif.otf');
    ttcPath = path.join(dir, 'Test.ttc');
    await fsp.writeFile(
      ttfPath,
      makeTtf({
        family: 'Test Serif',
        subfamily: 'Book',
        fullName: 'Test Serif Book',
        postScript: 'TestSerif-Book',
        version: 'Version 1.002',
        copyright: 'Copyright 2026 Test',
        licenseDescription: 'This font is licensed under the OFL.',
      }),
    );
    await fsp.writeFile(
      otfPath,
      makeOtf({ family: 'Overpass', subfamily: 'Regular', fullName: 'Overpass Regular' }),
    );
    await fsp.writeFile(
      ttcPath,
      makeTtc([{ family: 'Times', subfamily: 'Regular' }, { family: 'Times Bold', subfamily: 'Bold' }]),
    );
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
    await cleanup(env);
  });

  it('extracts metadata from a TrueType font', () => {
    const metadata = new FontMetadataExtractor(ttfPath).extract();

    expect(metadata).toBeInstanceOf(FontMetadata);
    expect(metadata.familyName).toBe('Test Serif');
    expect(metadata.subfamilyName).toBe('Book');
    expect(metadata.fullName).toBe('Test Serif Book');
    expect(metadata.postscriptName).toBe('TestSerif-Book');
  });

  it('extracts version without the Version prefix', () => {
    const metadata = new FontMetadataExtractor(ttfPath).extract();

    expect(metadata.version).not.toBeNull();
    expect(metadata.version).not.toMatch(/^Version\s+/i);
    expect(metadata.version).toBe('1.002');
  });

  it('extracts copyright and license description', () => {
    const metadata = new FontMetadataExtractor(ttfPath).extract();

    expect(metadata.copyright).toBe('Copyright 2026 Test');
    expect(metadata.description).toBe('This font is licensed under the OFL.');
  });

  it('detects font format', () => {
    expect(new FontMetadataExtractor(ttfPath).extract().fontFormat).toBe('truetype');
    expect(new FontMetadataExtractor(otfPath).extract().fontFormat).toBe('cff');
  });

  it('extracts metadata from the first font in a collection', () => {
    const metadata = new FontMetadataExtractor(ttcPath).extract();

    expect(metadata).toBeInstanceOf(FontMetadata);
    expect(metadata.familyName).toBe('Times');
    expect(metadata.subfamilyName).toBe('Regular');
  });

  it('raises FontExtractError for an invalid font file', async () => {
    const invalid = path.join(dir, 'not-a-font.ttf');
    await fsp.writeFile(invalid, Buffer.from('definitely not a font'));
    expect(() => new FontMetadataExtractor(invalid).extract()).toThrow(FontExtractError);
  });

  it('raises FontExtractError for a non-existent file', () => {
    expect(() => new FontMetadataExtractor(path.join(dir, 'missing.ttf')).extract()).toThrow(
      FontExtractError,
    );
  });
});
