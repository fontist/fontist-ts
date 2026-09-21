import { describe, expect, it } from 'vitest';
import { Formula, keyFromPath, titleize } from '../src/formula/formula.js';
import { GoogleImportSource, MacosImportSource } from '../src/formula/importSources.js';

const V5_YAML = `---
schema_version: 5
name: Overpass
description: Overpass font family
homepage: https://overpassfont.org
resources:
  overpass.zip:
    urls:
    - https://example.com/overpass.zip
    sha256: 157f954ada377516d64ce727e5cb5122106f70ee65142d9b2971463cca690ffc
    file_size: 1529937
fonts:
- name: Overpass
  styles:
  - family_name: Overpass
    type: Regular
    full_name: Overpass Regular
    post_script_name: Overpass-Regular
    version: 3.0.4
    font: Overpass-Regular.ttf
  - family_name: Overpass
    type: Bold
    full_name: Overpass Bold
    post_script_name: Overpass-Bold
    version: 3.0.4
    font: Overpass-Bold.ttf
    formats:
    - ttf
    variable_font: true
    variable_axes:
    - wght
extract:
- options:
  - fonts_sub_dir: fonts/
`;

const V4_YAML = `---
name: Andale
description: Andale Mono
homepage: https://www.monotype.com
resources:
  andale.exe:
    urls:
    - https://example.com/andale32.exe
fonts:
- name: Andale Mono
  styles:
  - family_name: Andale Mono
    type: Regular
    full_name: Andale Mono
    post_script_name: AndaleMono
    font: AndaleMo.TTF
`;

const COLLECTION_YAML = `---
schema_version: 5
font_collections:
- filename: SourceHanSans-Bold.ttc
  source_filename: source-han.ttc
  fonts:
  - name: Source Han Sans
    styles:
    - family_name: Source Han Sans
      type: Bold
      full_name: Source Han Sans Bold
      font: SourceHanSans-Bold.ttc
`;

describe('Formula model', () => {
  it('parses a v5 formula with resources childMappings', () => {
    const formula = Formula.fromYaml(V5_YAML) as Formula;
    expect(formula.isV5()).toBe(true);
    expect(formula.effectiveSchemaVersion()).toBe(5);
    expect(formula.name).toBe('Overpass');
    expect(formula.resources).toHaveLength(1);
    const resource = formula.resources[0]!;
    expect(resource.name).toBe('overpass.zip');
    expect(resource.urls).toEqual(['https://example.com/overpass.zip']);
    expect(resource.sha256).toEqual(['157f954ada377516d64ce727e5cb5122106f70ee65142d9b2971463cca690ffc']);
    expect(resource.fileSize).toBe(1529937);
  });

  it('parses a v4 formula and reports schema version 4', () => {
    const formula = Formula.fromYaml(V4_YAML) as Formula;
    expect(formula.isV5()).toBe(false);
    expect(formula.effectiveSchemaVersion()).toBe(4);
    expect(formula.isDownloadable()).toBe(true);
  });

  it('round-trips a v5 formula through YAML preserving shape', () => {
    const formula = Formula.fromYaml(V5_YAML) as Formula;
    const again = Formula.fromYaml(formula.toYaml()) as Formula;
    expect(again.toYamlObject()).toEqual(formula.toYamlObject());
    const roundTripped = again.toYamlObject();
    expect(roundTripped.schema_version).toBe(5);
    expect(roundTripped.resources).toHaveProperty('overpass.zip');
    const resources = roundTripped.resources as Record<string, { urls: string[]; file_size: number }>;
    expect(resources['overpass.zip']!.file_size).toBe(1529937);
  });

  it('omits schema_version for v4 formulas on serialization', () => {
    const formula = Formula.fromYaml(V4_YAML) as Formula;
    expect(formula.toYamlObject()).not.toHaveProperty('schema_version');
  });

  it('normalizes collection fonts to point at the collection file', () => {
    const formula = Formula.fromYaml(COLLECTION_YAML) as Formula;
    const fonts = formula.allFonts();
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.styles[0]!.font).toBe('SourceHanSans-Bold.ttc');
    expect(fonts[0]!.styles[0]!.sourceFont).toBe('source-han.ttc');
  });

  it('looks up fonts case-insensitively', () => {
    const formula = Formula.fromYaml(V5_YAML) as Formula;
    expect(formula.fontByName('overpass')?.name).toBe('Overpass');
    expect(formula.fontByName('OVERPASS')?.name).toBe('Overpass');
    expect(formula.fontByName('missing')).toBeNull();
    expect(formula.fontsByName('overpass')).toHaveLength(1);
  });

  it('exposes license helpers', () => {
    const licensed = Formula.fromYaml(
      V4_YAML.replace('homepage: https://www.monotype.com', 'homepage: https://www.monotype.com\nrequires_license_agreement: CONTACT_MONOTYPE'),
    ) as Formula;
    expect(licensed.licenseRequired()).toBe(true);
    expect(licensed.license()).toBe('CONTACT_MONOTYPE');
    const unlicensed = Formula.fromYaml(V4_YAML) as Formula;
    expect(unlicensed.licenseRequired()).toBe(false);
  });

  it('matches platforms exactly and via os-prefixed entries', () => {
    const formula = Formula.fromYaml(V4_YAML) as Formula;
    expect(formula.compatibleWithPlatform('macos')).toBe(true);
    const restricted = Formula.fromYaml(`${V4_YAML}platforms:\n- macos\n- macos-font7\n`) as Formula;
    expect(restricted.compatibleWithPlatform('macos')).toBe(true);
    expect(restricted.compatibleWithPlatform('linux')).toBe(false);
    expect(restricted.compatibleWithPlatform('windows')).toBe(false);
  });

  it('parses polymorphic import sources', () => {
    const formula = Formula.fromYaml(
      `${COLLECTION_YAML}import_source:\n  type: macos\n  framework_version: 8\n  posted_date: '2025-08-05T18:58:57Z'\n  asset_id: 10m11177\n`,
    ) as Formula;
    expect(formula.importSource).toBeInstanceOf(MacosImportSource);
    expect(formula.isMacosImport()).toBe(true);
    expect((formula.importSource as MacosImportSource).assetId).toBe('10m11177');
    expect(formula.importSource!.yamlTag()).toBe('macos');
    const google = Formula.fromYaml(
      `${V5_YAML}import_source:\n  type: google\n  commit_id: abc123\n  family_id: Overpass\n`,
    ) as Formula;
    expect(google.importSource).toBeInstanceOf(GoogleImportSource);
    expect(google.isGoogleImport()).toBe(true);
  });

  it('detects requires_system_installation for apple_cdn macos formulas', () => {
    const formula = Formula.fromYaml(`---
schema_version: 5
platforms:
- macos
resources:
  asset.zip:
    source: apple_cdn
    urls:
    - https://example.com/a.zip
`) as Formula;
    expect(formula.requiresSystemInstallation()).toBe(true);
    expect(formula.source()).toBe('apple_cdn');
  });

  it('computes keys from paths relative to the Formulas root', () => {
    expect(keyFromPath('/r/Formulas/macos/inaimathi.yml', '/r/Formulas')).toBe('macos/inaimathi');
    expect(keyFromPath('/r/Formulas/andale.yml', '/r/Formulas')).toBe('andale');
    expect(titleize('macos/inaimathi')).toBe('Macos/Inaimathi');
    expect(titleize('adobe_reader_19')).toBe('Adobe Reader 19');
  });
});
