// Mirrors spec/fontist/import/create_formula_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateFormula } from '../../src/import/createFormula.js';
import { normalizeFilename } from '../../src/import/formulaBuilder.js';
import { makeTtf, makeTtc, makeZip, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

const OFL_TEXT = [
  'Copyright 2026 The Test Font Project Authors (https://example.com)',
  '',
  'This Font Software is licensed under the SIL Open Font License,',
  'Version 1.1. This license is available with a FAQ at:',
  'https://scripts.sil.org/OFL',
].join('\n');

async function runCreate(env: TestEnv, cwd: string, url: string, options = {}): Promise<string> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await new CreateFormula(env.ctx, url, options).call();
  } finally {
    process.chdir(previousCwd);
  }
}

describe('CreateFormula', () => {
  let env: TestEnv;
  let cwd: string;
  let fixtureDir: string;

  beforeAll(async () => {
    env = await testEnv();
    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-create-cwd-'));
    fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-create-fixtures-'));

    // zip archive: three faces of one family with versions (Euphemia-style)
    const euphemiaZip = path.join(fixtureDir, '_2.6.6 Euphemia UCAS.zip');
    await fsp.writeFile(
      euphemiaZip,
      makeZip([
        {
          name: 'Euphemia UCAS Regular 2.6.6.ttf',
          data: makeTtf({
            family: 'Euphemia UCAS',
            subfamily: 'Regular',
            fullName: 'Euphemia UCAS Regular',
            postScript: 'EuphemiaUCAS-Regular',
            version: 'Version 2.6.6',
            copyright: '© 2026 Euphemia contributors',
            vendorUrl: 'https://example.com/euphemia',
            licenseUrl: 'https://example.com/euphemia/license',
          }),
        },
        {
          name: 'Euphemia UCAS Bold 2.6.6.ttf',
          data: makeTtf({
            family: 'Euphemia UCAS',
            subfamily: 'Bold',
            fullName: 'Euphemia UCAS Bold',
            postScript: 'EuphemiaUCAS-Bold',
            version: 'Version 2.6.6',
          }),
        },
        {
          name: 'Euphemia UCAS Italic 2.6.6.ttf',
          data: makeTtf({
            family: 'Euphemia UCAS',
            subfamily: 'Italic',
            fullName: 'Euphemia UCAS Italic',
            postScript: 'EuphemiaUCAS-Italic',
            version: 'Version 2.6.6',
          }),
        },
      ]),
    );

    // zip with license (Lato-style)
    const latoZip = path.join(fixtureDir, 'Lato2OFL.zip');
    await fsp.writeFile(
      latoZip,
      makeZip([
        {
          name: 'Lato-Regular.ttf',
          data: makeTtf({
            family: 'Lato',
            subfamily: 'Regular',
            fullName: 'Lato Regular',
            postScript: 'Lato-Regular',
            version: 'Version 2.0',
            copyright: 'Copyright (c) 2011-2022 by tyPoland',
          }),
        },
        { name: 'OFL.txt', data: Buffer.from(OFL_TEXT) },
      ]),
    );

    // zip containing a collection font
    const sourceZip = path.join(fixtureDir, 'source_example.zip');
    await fsp.writeFile(
      sourceZip,
      makeZip([
        {
          name: 'Sample.ttc',
          data: makeTtc([
            { family: 'Sample Han Sans', subfamily: 'Regular', fullName: 'Sample Han Sans' },
            { family: 'Sample Han Sans', subfamily: 'Bold', fullName: 'Sample Han Sans Bold' },
          ]),
        },
      ]),
    );
  });

  afterAll(async () => {
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(fixtureDir, { recursive: true, force: true });
    await cleanup(env);
  });

  it('generates proper yaml for a zip archive', async () => {
    const formulaFile = await runCreate(
      env,
      cwd,
      path.join(fixtureDir, '_2.6.6 Euphemia UCAS.zip'),
    );

    expect(formulaFile).toBe('euphemia_ucas.yml');
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));

    expect(formula['name']).toBe('Euphemia UCAS');
    expect(formula['description']).toBe('Euphemia UCAS');
    expect(formula['full_name'] ?? formula['fonts']).toBeTruthy();
    expect(formula['fonts']).toHaveLength(1);
    expect(formula['fonts'][0]['name']).toBe('Euphemia UCAS');
    const types = formula['fonts'][0]['styles'].map((s: Record<string, unknown>) => s['type']);
    expect(types).toEqual(['Bold', 'Italic', 'Regular']);
    expect(formula['fonts'][0]['styles'][0]['family_name']).toBe('Euphemia UCAS');
    expect(formula['fonts'][0]['styles'][2]['font']).toBe('Euphemia UCAS Regular 2.6.6.ttf');
    expect(formula['font_version']).toBe('2.6.6');
    expect(formula['extract']).toEqual({});
    expect(formula['resources']).toBeTruthy();
  });

  it('captures the license text for an OFL archive', async () => {
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'Lato2OFL.zip'));
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));

    expect(formulaFile).toBe('lato.yml');
    expect(formula['open_license']).toContain('SIL Open Font License');
    expect(formula['open_license']).not.toContain('\r');
    expect(formula['copyright']).toBe('Copyright (c) 2011-2022 by tyPoland');
  });

  it('generates font_collections for archives with collection fonts', async () => {
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'source_example.zip'));
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));

    expect(formula['fonts']).toBeUndefined();
    const collections = formula['font_collections'];
    expect(collections).toHaveLength(1);
    expect(collections[0]['filename']).toBe('Sample.ttc');
    expect(collections[0]['fonts'][0]['name']).toBe('Sample Han Sans');
    const types = collections[0]['fonts'][0]['styles'].map((s: Record<string, unknown>) => s['type']);
    expect(types).toEqual(['Bold', 'Regular']);
    // collection styles carry no font/source_font keys
    expect(collections[0]['fonts'][0]['styles'][0]).not.toHaveProperty('font');
  });

  it('honors the file_pattern option', async () => {
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'Lato2OFL.zip'), {
      filePattern: '*Regular.ttf',
    });
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));
    expect(formula['fonts'][0]['styles']).toHaveLength(1);
    expect(formula['fonts'][0]['styles'][0]['font']).toBe('Lato-Regular.ttf');
  });

  it('honors the name option', async () => {
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'Lato2OFL.zip'), {
      name: 'Custom Lato',
    });
    expect(formulaFile).toBe('custom_lato.yml');
  });

  it('adds v5 format metadata for schema_version 5', async () => {
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'Lato2OFL.zip'), {
      schemaVersion: 5,
    });
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));
    expect(formula['schema_version']).toBe(5);
    const resource = Object.values(formula['resources'])[0] as Record<string, unknown>;
    expect(resource['format']).toBe('ttf');
  });

  it('adds variable axes from filename patterns for v5', async () => {
    const vfZip = path.join(fixtureDir, 'vf.zip');
    await fsp.writeFile(
      vfZip,
      makeZip([
        {
          name: 'TestFont[wght].ttf',
          data: makeTtf(
            { family: 'TestFont', subfamily: 'Regular', fullName: 'TestFont' },
            [{ tag: 'wght' }],
          ),
        },
      ]),
    );
    const formulaFile = await runCreate(env, cwd, vfZip, { schemaVersion: 5 });
    const formula = yaml.parse(await fsp.readFile(path.join(cwd, formulaFile), 'utf8'));
    const resource = Object.values(formula['resources'])[0] as Record<string, unknown>;
    expect(resource['variable_axes']).toEqual(['wght']);
    expect(formula['fonts'][0]['styles'][0]['font']).toBe('TestFont[wght].ttf');
  });

  it('overrides an existing formula', async () => {
    const target = path.join(cwd, 'euphemia_ucas.yml');
    await fsp.writeFile(target, 'name: OLD\n');
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, '_2.6.6 Euphemia UCAS.zip'));
    expect(formulaFile).toBe('euphemia_ucas.yml');
    const formula = yaml.parse(await fsp.readFile(target, 'utf8'));
    expect(formula['name']).toBe('Euphemia UCAS');
  });

  it('keeps the existing file with the keep_existing option', async () => {
    const target = path.join(cwd, 'euphemia_ucas.yml');
    const before = await fsp.readFile(target, 'utf8');
    const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, '_2.6.6 Euphemia UCAS.zip'), {
      keepExisting: true,
    });
    expect(formulaFile).toBe('euphemia_ucas.yml');
    expect(await fsp.readFile(target, 'utf8')).toBe(before);
  });

  it('writes into formula_dir when given', async () => {
    const formulaDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-formula-dir-'));
    try {
      const formulaFile = await runCreate(env, cwd, path.join(fixtureDir, 'Lato2OFL.zip'), {
        formulaDir,
      });
      expect(formulaFile).toBe(path.join(formulaDir, 'lato.yml'));
      expect(await fsp.stat(formulaFile)).toBeTruthy();
    } finally {
      await fsp.rm(formulaDir, { recursive: true, force: true });
    }
  });

  it('normalizes names consistently', () => {
    expect(normalizeFilename('Euphemia UCAS')).toBe('euphemia_ucas');
    expect(normalizeFilename('Source Han Sans')).toBe('source_han_sans');
  });

  it('raises FontNotFoundError for archives without fonts', async () => {
    const emptyZip = path.join(fixtureDir, 'empty.zip');
    await fsp.writeFile(emptyZip, makeZip([{ name: 'README.txt', data: Buffer.from('hi') }]));
    await expect(runCreate(env, cwd, emptyZip)).rejects.toThrow(/No fonts found in archive/);
  });
});
