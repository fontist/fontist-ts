// Mirrors spec/fontist/import_source_spec.rb, spec/fontist/google_import_source_spec.rb,
// spec/fontist/macos_import_source_spec.rb, spec/fontist/sil_import_source_spec.rb,
// spec/fontist/windows_import_source_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import {
  GoogleImportSource,
  ImportSource,
  MacosImportSource,
  SilImportSource,
  WindowsImportSource,
} from '../../src/formula/importSources.js';

describe('ImportSource (abstract methods)', () => {
  it('raises for differentiation_key on the base class', () => {
    const source = new ImportSource();
    expect(() => source.differentiationKey()).toThrow(/must implement #differentiation_key/);
  });

  it('raises for outdated? on the base class', () => {
    const source = new ImportSource();
    expect(() => source.isOutdated(new SilImportSource())).toThrow(/must implement #outdated\?/);
  });
});

describe('MacosImportSource', () => {
  const source = new MacosImportSource({
    type: 'macos',
    framework_version: 7,
    posted_date: '2022-04-13T00:00:00Z',
    asset_id: 'ABC123',
  });

  it('lowercases the asset id as differentiation key', () => {
    expect(source.differentiationKey()).toBe('abc123');
  });

  it('compares posted dates for outdatedness', () => {
    const newer = new MacosImportSource({
      type: 'macos',
      framework_version: 7,
      posted_date: '2022-06-01T00:00:00Z',
      asset_id: 'abc123',
    });
    const otherType = new SilImportSource({ type: 'sil', version: '1.0' });
    const noDate = new MacosImportSource({ type: 'macos', framework_version: 7 });

    expect(source.isOutdated(newer)).toBe(true);
    expect(newer.isOutdated(source)).toBe(false);
    expect(source.isOutdated(otherType)).toBe(false);
    expect(noDate.isOutdated(newer)).toBe(false);
  });

  it('compares framework version and case-insensitive asset id for equality', () => {
    const same = new MacosImportSource({
      type: 'macos',
      framework_version: 7,
      posted_date: '2020-01-01T00:00:00Z',
      asset_id: 'abc123',
    });
    const otherFramework = new MacosImportSource({
      type: 'macos',
      framework_version: 8,
      asset_id: 'abc123',
    });

    expect(source.equals(same)).toBe(true);
    expect(source.equals(otherFramework)).toBe(false);
    expect(source.equals(new SilImportSource({ type: 'sil', version: '1' }))).toBe(false);
  });

  it('exposes framework metadata', () => {
    expect(source.minMacosVersion()).toBe('12.0');
    expect(source.maxMacosVersion()).toBe('15.99');
    expect(source.compatibleWithMacos('13.0')).toBe(true);
    expect(source.compatibleWithMacos('11.0')).toBe(false);
    expect(source.compatibleWithMacos('16.0')).toBe(false);
    expect(source.parserClassName()).toBe('Fontist::Macos::Catalog::Font7Parser');
    expect(source.frameworkDescription()).toContain('Font7 framework');
  });

  it('round-trips through the polymorphic registry', () => {
    const restored = MacosImportSource.fromYamlObject({
      type: 'macos',
      framework_version: 7,
      posted_date: '2022-04-13T00:00:00Z',
      asset_id: 'ABC123',
    }) as MacosImportSource;
    expect(restored).toBeInstanceOf(MacosImportSource);
    expect(restored.frameworkVersion).toBe(7);
    expect(restored.differentiationKey()).toBe('abc123');
  });
});

describe('GoogleImportSource', () => {
  const source = new GoogleImportSource({
    type: 'google',
    commit_id: 'b9bd3f35',
    api_version: 'v1',
    last_modified: '2025-09-08',
    family_id: 'abeezee',
  });

  it('uses no differentiation key (live service, simple filenames)', () => {
    expect(source.differentiationKey()).toBeNull();
  });

  it('is outdated when the commit id differs', () => {
    const newer = new GoogleImportSource({ type: 'google', commit_id: 'deadbee' });
    const same = new GoogleImportSource({ type: 'google', commit_id: 'b9bd3f35' });
    const noCommit = new GoogleImportSource({ type: 'google' });

    expect(source.isOutdated(newer)).toBe(true);
    expect(source.isOutdated(same)).toBe(false);
    expect(source.isOutdated(noCommit)).toBe(false);
    expect(source.isOutdated(new SilImportSource({ type: 'sil', version: '1' }))).toBe(false);
  });

  it('compares commit ids for equality', () => {
    expect(source.equals(new GoogleImportSource({ type: 'google', commit_id: 'b9bd3f35' }))).toBe(true);
    expect(source.equals(new GoogleImportSource({ type: 'google', commit_id: 'deadbee' }))).toBe(false);
  });
});

describe('SilImportSource', () => {
  const source = new SilImportSource({
    type: 'sil',
    version: '6.200',
    release_date: '2025-01-01T00:00:00Z',
  });

  it('uses the version as differentiation key', () => {
    expect(source.differentiationKey()).toBe('6.200');
  });

  it('compares versions lexicographically', () => {
    const newer = new SilImportSource({ type: 'sil', version: '6.300' });
    const older = new SilImportSource({ type: 'sil', version: '6.100' });
    const noVersion = new SilImportSource({ type: 'sil' });

    expect(source.isOutdated(newer)).toBe(true);
    expect(source.isOutdated(older)).toBe(false);
    expect(source.isOutdated(noVersion)).toBe(false);
  });

  it('compares versions for equality', () => {
    expect(source.equals(new SilImportSource({ type: 'sil', version: '6.200' }))).toBe(true);
    expect(source.equals(new SilImportSource({ type: 'sil', version: '6.300' }))).toBe(false);
  });
});

describe('WindowsImportSource', () => {
  const source = new WindowsImportSource({
    type: 'windows',
    capability_name: 'Language.Fonts.Jpan~~~0.0.1.0',
    min_windows_version: '10.0',
  });

  it('uses the capability name as differentiation key', () => {
    expect(source.differentiationKey()).toBe('Language.Fonts.Jpan~~~0.0.1.0');
  });

  it('is never outdated', () => {
    expect(source.isOutdated(source)).toBe(false);
    expect(source.isOutdated(new SilImportSource({ type: 'sil', version: '1' }))).toBe(false);
  });

  it('compares capability names for equality', () => {
    expect(
      source.equals(new WindowsImportSource({ type: 'windows', capability_name: 'Language.Fonts.Jpan~~~0.0.1.0' })),
    ).toBe(true);
    expect(
      source.equals(new WindowsImportSource({ type: 'windows', capability_name: 'Other' })),
    ).toBe(false);
  });
});
