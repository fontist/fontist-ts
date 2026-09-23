// Mirrors spec/fontist/import/windows_spec.rb and
// spec/fontist/windows_fod_metadata_spec.rb (Ruby gem).
import { promises as fsp, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WindowsFodMetadata } from '../../src/import/windows/windowsFodMetadata.js';
import { WindowsImport } from '../../src/import/windows/windowsImport.js';
import { normalizeKey } from '../../src/import/windows/formulaKey.js';
import { testEnv, cleanup, type TestEnv } from '../helpers/index.js';

describe('WindowsFodMetadata', () => {
  beforeAll(() => {
    WindowsFodMetadata.resetCache();
  });

  it('lists all capabilities and font names', () => {
    const capabilities = WindowsFodMetadata.allCapabilities();
    expect(capabilities.length).toBeGreaterThan(0);
    expect(capabilities).toContain('Language.Fonts.Arab~~~und-ARAB~0.0.1.0');
    expect(WindowsFodMetadata.allFontNames()).toContain('Andalus');
  });

  it('reverse-looks-up a capability for a font name', () => {
    expect(WindowsFodMetadata.capabilityForFont('Andalus')).toBe(
      'Language.Fonts.Arab~~~und-ARAB~0.0.1.0',
    );
    expect(WindowsFodMetadata.capabilityForFont('andalus')).toBe(
      'Language.Fonts.Arab~~~und-ARAB~0.0.1.0',
    );
    expect(WindowsFodMetadata.capabilityForFont('NoSuchFont')).toBeNull();
  });

  it('exposes fonts and descriptions per capability', () => {
    const cap = 'Language.Fonts.Arab~~~und-ARAB~0.0.1.0';
    const fonts = WindowsFodMetadata.fontsForCapability(cap);
    expect(fonts).not.toBeNull();
    expect(Object.keys(fonts!)).toContain('Andalus');
    expect(WindowsFodMetadata.descriptionForCapability(cap)).toContain('Arabic');
    expect(WindowsFodMetadata.descriptionForCapability('bogus')).toBeNull();
  });
});

describe('WindowsImport', () => {
  let env: TestEnv;
  let formulasDir: string;

  beforeAll(async () => {
    env = await testEnv();
    formulasDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-win-'));
  });

  afterAll(async () => {
    await fsp.rm(formulasDir, { recursive: true, force: true });
    await cleanup(env);
  });

  it('generates formula files for all capabilities', () => {
    new WindowsImport(env.ctx, { formulasDir }).call();

    const capabilities = WindowsFodMetadata.allCapabilities();
    const ymlFiles = listYaml(formulasDir);
    expect(ymlFiles.length).toBe(capabilities.length);
  });

  it('generates valid YAML with required keys', async () => {
    const ymlFiles = listYaml(formulasDir);
    const data = yaml.parse(await fsp.readFile(ymlFiles[0]!, 'utf8'));
    expect(data).toHaveProperty('name');
    expect(data['platforms']).toEqual(['windows']);
    expect(data).toHaveProperty('resources');
    expect(data).toHaveProperty('fonts');
    expect(data).toHaveProperty('import_source');
  });

  it('sets schema_version to 5', async () => {
    const ymlFiles = listYaml(formulasDir);
    const data = yaml.parse(await fsp.readFile(ymlFiles[0]!, 'utf8'));
    expect(data['schema_version']).toBe(5);
  });

  it('includes windows_fod source in resources', async () => {
    const arabic = path.join(
      formulasDir,
      `${normalizeKey('Arabic Script Supplemental Fonts')}.yml`,
    );
    const data = yaml.parse(await fsp.readFile(arabic, 'utf8'));
    const resource = Object.values(data['resources'])[0] as Record<string, unknown>;
    expect(resource['source']).toBe('windows_fod');
    expect(resource).toHaveProperty('capability_name');
  });

  it('sets import_source type to windows', async () => {
    const ymlFiles = listYaml(formulasDir);
    const data = yaml.parse(await fsp.readFile(ymlFiles[0]!, 'utf8'));
    expect(data['import_source']['type']).toBe('windows');
    expect(data['import_source']).toHaveProperty('capability_name');
    expect(data['import_source']['min_windows_version']).toBe('10.0');
  });

  it('maps each style to a ttf format with variable_font false', async () => {
    const arabic = path.join(
      formulasDir,
      `${normalizeKey('Arabic Script Supplemental Fonts')}.yml`,
    );
    const data = yaml.parse(await fsp.readFile(arabic, 'utf8'));
    const fonts = data['fonts'] as Array<Record<string, unknown>>;
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      for (const style of font['styles'] as Array<Record<string, unknown>>) {
        expect(style['formats']).toEqual(['ttf']);
        expect(style['variable_font']).toBe(false);
        expect(style['family_name']).toBe(font['name']);
      }
    }
  });
});

function listYaml(dir: string): string[] {
  return readDirRecursive(dir).filter((f) => f.endsWith('.yml'));
}

function readDirRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else out.push(full);
  }
  return out;
}
