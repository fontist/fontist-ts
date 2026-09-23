// Mirrors spec/fontist/import/v4_to_v5_migrator_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { V4ToV5Migrator } from '../../src/import/v4ToV5Migrator.js';

describe('V4ToV5Migrator#migrateFile', () => {
  let tmpdir: string;

  beforeAll(async () => {
    tmpdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-migrate-'));
  });

  afterAll(async () => {
    await fsp.rm(tmpdir, { recursive: true, force: true });
  });

  async function writeFormula(data: Record<string, unknown>, filename = 'test_font.yml'): Promise<string> {
    const filePath = path.join(tmpdir, filename);
    await fsp.writeFile(filePath, yaml.stringify(data, { lineWidth: 0 }));
    return filePath;
  }

  it('adds schema_version: 5', async () => {
    const filePath = await writeFormula({
      name: 'Test Font',
      resources: {
        'TestFont.zip': {
          urls: ['https://example.com/TestFont.zip'],
          files: ['TestFont-Regular.ttf'],
        },
      },
      fonts: [
        {
          name: 'Test Font',
          styles: [
            {
              family_name: 'Test Font',
              type: 'Regular',
              font: 'TestFont-Regular.ttf',
            },
          ],
        },
      ],
    });

    const result = new V4ToV5Migrator(filePath).migrateFile(filePath);
    expect(result).toBe('migrated');

    const migrated = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(migrated['schema_version']).toBe(5);
  });

  it('skips already-v5 formulas', async () => {
    const filePath = await writeFormula({ schema_version: 5, name: 'Already V5' });
    const result = new V4ToV5Migrator(filePath).migrateFile(filePath);
    expect(result).toBe('skipped');
  });

  it('detects format from font file extension in resources', async () => {
    const filePath = await writeFormula({
      name: 'Font With TTF',
      resources: {
        font_resource: {
          urls: ['https://fonts.example.com/MyFont-Regular.ttf'],
          files: ['MyFont-Regular.ttf'],
        },
      },
      fonts: [],
    });

    new V4ToV5Migrator(filePath).migrateFile(filePath);
    const migrated = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(migrated['resources']['font_resource']['format']).toBe('ttf');
  });

  it('detects variable axes from filename patterns', async () => {
    const filePath = await writeFormula({
      name: 'Variable Font',
      resources: {
        vf_resource: {
          urls: ['https://example.com/Font[wght,ital].ttf'],
          files: ['Font[wght,ital].ttf'],
        },
      },
      fonts: [],
    });

    new V4ToV5Migrator(filePath).migrateFile(filePath);
    const migrated = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(migrated['resources']['vf_resource']['variable_axes']).toEqual(['wght', 'ital']);
  });

  it('does not treat archive resources as font formats', async () => {
    const filePath = await writeFormula({
      name: 'Archive Only',
      resources: {
        'bundle.exe': {
          urls: ['https://example.com/bundle.exe'],
          files: [],
        },
      },
      fonts: [],
    });

    new V4ToV5Migrator(filePath).migrateFile(filePath);
    const migrated = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(migrated['resources']['bundle.exe']['format']).toBeUndefined();
  });
});

describe('V4ToV5Migrator#migrateAll', () => {
  let tmpdir: string;

  beforeAll(async () => {
    tmpdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-migrate-all-'));
  });

  afterAll(async () => {
    await fsp.rm(tmpdir, { recursive: true, force: true });
  });

  async function writeFormula(data: Record<string, unknown>, filename: string): Promise<string> {
    const filePath = path.join(tmpdir, filename);
    await fsp.writeFile(filePath, yaml.stringify(data, { lineWidth: 0 }));
    return filePath;
  }

  it('returns a migration summary', async () => {
    await writeFormula({ name: 'Font A', resources: {}, fonts: [] }, 'a.yml');
    await writeFormula({ schema_version: 5, name: 'Font B' }, 'b.yml');

    const results = new V4ToV5Migrator(tmpdir).migrateAll();
    expect(results).toEqual({ migrated: 1, skipped: 1, failed: 0, errors: [] });
  });

  it('handles dry_run mode without writing', async () => {
    const filePath = await writeFormula({ name: 'Dry Font' }, 'dry_font.yml');
    const results = new V4ToV5Migrator(filePath, null, { dryRun: true }).migrateAll();
    expect(results.migrated).toBe(1);
    const unchanged = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(unchanged['schema_version']).toBeUndefined();
  });

  it('writes to an output directory while keeping filenames', async () => {
    const filePath = await writeFormula({ name: 'Out Font' }, 'out_font.yml');
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-migrate-out-'));
    try {
      const results = new V4ToV5Migrator(filePath, outDir).migrateAll();
      expect(results.migrated).toBe(1);
      const written = yaml.parse(await fsp.readFile(path.join(outDir, 'out_font.yml'), 'utf8'));
      expect(written['schema_version']).toBe(5);
      // source untouched
      const source = yaml.parse(await fsp.readFile(filePath, 'utf8'));
      expect(source['schema_version']).toBeUndefined();
    } finally {
      await fsp.rm(outDir, { recursive: true, force: true });
    }
  });
});
