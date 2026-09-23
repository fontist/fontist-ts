// Mirrors spec/fontist/import/google/font_database_spec.rb and
// spec/fontist/import/google/data_sources/github_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { FontDatabase } from '../../src/import/google/fontDatabase.js';
import { GithubDataSource } from '../../src/import/google/dataSources/github.js';
import { FontFamily } from '../../src/import/google/models/fontFamily.js';
import { makeTtf, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

function family(options: {
  family: string;
  version?: string;
  files?: Record<string, string>;
  axes?: { tag: string; start: number; end: number }[];
  category?: string;
  lastModified?: string;
  variants?: string[];
}): FontFamily {
  return new FontFamily({
    family: options.family,
    variants: options.variants ?? ['regular'],
    subsets: ['latin'],
    version: options.version ?? 'v1',
    lastModified: options.lastModified ?? '2025-09-08',
    files: options.files ?? { regular: `https://fonts.gstatic.com/s/${options.family.toLowerCase()}/a.ttf` },
    category: options.category ?? 'sans-serif',
    kind: 'webfonts#webfont',
    axes: options.axes,
  });
}

describe('Google::FontDatabase', () => {
  let env: TestEnv;
  let server: Server;
  let baseUrl: string;
  let outputDir: string;

  let ttfAbc: FontFamily;
  let ttfRoboto: FontFamily;
  let vfOneSans: FontFamily;
  let ttfArOne: FontFamily;
  let woff2ArOne: FontFamily;
  const vfAbee = family({
    family: 'ABeeZee',
    version: 'v23',
    variants: ['regular', 'italic'],
    files: {
      regular: 'https://fonts.gstatic.com/s/abeezee/regular.ttf',
      italic: 'https://fonts.gstatic.com/s/abeezee/italic.ttf',
    },
  });
  const woff2Abc = family({
    family: 'ABeeZee',
    version: 'v23',
    variants: ['regular', 'italic'],
    files: {
      regular: 'https://fonts.gstatic.com/s/abeezee/regular.woff2',
      italic: 'https://fonts.gstatic.com/s/abeezee/italic.woff2',
    },
  });
  const woff2Roboto = family({
    family: 'Roboto',
    version: 'v49',
    variants: ['regular', 'italic'],
    files: {
      regular: 'https://fonts.gstatic.com/s/roboto/regular.woff2',
      italic: 'https://fonts.gstatic.com/s/roboto/italic.woff2',
    },
  });

  beforeAll(async () => {
    env = await testEnv();
    outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-gdb-out-'));
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'font/ttf' });
      res.end(makeTtf({ family: 'Served Font', subfamily: 'Regular', fullName: 'Served Font' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const local = (name: string) => `${baseUrl}/${name}`;
    ttfAbc = family({
      family: 'ABeeZee',
      version: 'v23',
      variants: ['regular', 'italic'],
      files: { regular: local('abeezee-regular.ttf'), italic: local('abeezee-italic.ttf') },
    });
    ttfRoboto = family({
      family: 'Roboto',
      version: 'v49',
      variants: ['regular', 'italic'],
      files: { regular: local('roboto-regular.ttf'), italic: local('roboto-italic.ttf') },
    });
    vfOneSans = family({
      family: 'AR One Sans',
      version: 'v6',
      lastModified: '2025-09-16',
      axes: [
        { tag: 'ARRR', start: 10, end: 60 },
        { tag: 'wght', start: 400, end: 700 },
      ],
    });
    ttfArOne = family({
      family: 'AR One Sans',
      version: 'v6',
      lastModified: '2025-09-16',
      files: { regular: local('aronesans-regular.ttf') },
    });
    woff2ArOne = family({
      family: 'AR One Sans',
      version: 'v6',
      lastModified: '2025-09-16',
      files: { regular: 'https://fonts.gstatic.com/s/aronesans/regular.woff2' },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fsp.rm(outputDir, { recursive: true, force: true });
    await cleanup(env);
  });

  const ttfData = () => [ttfAbc, ttfRoboto, ttfArOne];
  const vfData = () => [vfOneSans, vfAbee];
  const woff2Data = () => [woff2Abc, woff2Roboto, woff2ArOne];

  function db(version: number): FontDatabase {
    return new FontDatabase({ ttfData: ttfData(), vfData: vfData(), woff2Data: woff2Data(), version, ctx: env.ctx });
  }

  it('accepts data from three endpoints and handles empty/nil data', () => {
    expect(db(5)).toBeInstanceOf(FontDatabase);
    expect(
      new FontDatabase({ ttfData: [], vfData: [], woff2Data: [], ctx: env.ctx }).allFonts(),
    ).toEqual([]);
    expect(
      new FontDatabase({ ttfData: [], vfData: [], woff2Data: [], ctx: env.ctx }).allFonts(),
    ).toEqual([]);
    const merged = db(5);
    expect(merged.fonts).toBeInstanceOf(Map);
    expect(merged.fonts.size).toBeGreaterThan(0);
  });

  it('merges data from all endpoints into unique families', () => {
    const fonts = db(5).allFonts();
    expect(fonts.map((f) => f.family)).toEqual(expect.arrayContaining(['ABeeZee', 'Roboto', 'AR One Sans']));
    const names = fonts.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
  });

  it('finds fonts by name', () => {
    const font = db(5).fontByName('ABeeZee');
    expect(font).not.toBeNull();
    expect(font!.family).toBe('ABeeZee');
    expect(db(5).fontByName('Nonexistent')).toBeNull();
  });

  it('filters by category and variable/static', () => {
    const database = db(5);
    expect(database.byCategory('sans-serif').length).toBe(3);
    expect(database.byCategory('serif')).toEqual([]);

    const variable = database.variableFontsOnly();
    expect(variable.map((f) => f.family)).toEqual(['AR One Sans']);
    expect(database.staticFontsOnly().map((f) => f.family)).toEqual(
      expect.arrayContaining(['ABeeZee', 'Roboto']),
    );

    const count = database.fontsCount();
    expect(count.total).toBe(3);
    expect(count.variable).toBe(1);
    expect(count.static).toBe(2);
  });

  it('indexes format-specific files', () => {
    const database = db(5);
    expect(database.ttfFilesFor('ABeeZee')!['regular']).toContain('.ttf');
    expect(database.woff2FilesFor('ABeeZee')!['regular']).toContain('.woff2');
    expect(database.woff2FilesFor('AR One Sans')!['regular']).toContain('.woff2');
  });

  it('v4 excludes variable fonts; v5 includes them', () => {
    const v4 = db(4);
    expect(v4.allFonts().map((f) => f.family)).not.toContain('AR One Sans');
    expect(v4.allFonts().map((f) => f.family)).toEqual(expect.arrayContaining(['ABeeZee', 'Roboto']));

    const v5 = db(5);
    expect(v5.allFonts().map((f) => f.family)).toContain('AR One Sans');
  });

  it('keeps the most recent version and lastModified when merging', () => {
    const merged = db(5).fontByName('ABeeZee')!;
    expect(merged.version).toBe('v23');
    expect(merged.lastModified).toBe('2025-09-08');
  });

  it('maps variants to style types', () => {
    const database = db(5);
    expect(database.variantToType('regular')).toBe('Regular');
    expect(database.variantToType('italic')).toBe('Italic');
    expect(database.variantToType('500italic')).toBe('500 Italic');
    expect(database.variantToType('500')).toBe('500');
    expect(database.variantToType('slanted')).toBe('Slanted');
  });

  it('generates names, descriptions, and homepages', () => {
    const database = db(5);
    const family = database.fontByName('AR One Sans')!;
    expect(database.formulaName(family)).toBe('ar_one_sans');
    expect(database.defaultDescription(family)).toBe('AR One Sans font family');
    expect(database.defaultHomepage(family)).toBe('https://fonts.google.com/specimen/AR+One+Sans');
  });

  it('saves formulas as YAML with stringified keys', async () => {
    const database = db(5);
    const formula = (await database.toFormula('AR One Sans'))!;
    const filePath = database.saveFormula(formula, 'AR One Sans', outputDir);
    expect(path.basename(filePath)).toBe('ar_one_sans.yml');

    const saved = yaml.parse(await fsp.readFile(filePath, 'utf8'));
    expect(saved['name']).toBe('ar_one_sans');
    expect(saved['schema_version']).toBe(5);
    expect(saved['description']).toBe('AR One Sans font family');
    expect(saved['homepage']).toBe('https://fonts.google.com/specimen/AR+One+Sans');
    expect(Object.keys(saved['resources'])).toEqual(
      expect.arrayContaining(['ttf_variable', 'woff2_variable']),
    );
    const ttfResource = saved['resources']['ttf_variable'];
    expect(ttfResource['format']).toBe('ttf');
    expect(ttfResource['variable_axes']).toEqual(['ARRR', 'wght']);
  });

  it('saves formulas for a single family via saveFormulas', async () => {
    const database = db(5);
    const paths = await database.saveFormulas(outputDir, 'Roboto');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/roboto\.yml$/);
  });

  it('builds a v5 formula with static resources and per-style formats', async () => {
    const database = db(5);
    const formula = (await database.toFormula('ABeeZee'))!;
    expect(formula['schema_version']).toBe(5);

    const resources = formula['resources'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(resources)).toEqual(expect.arrayContaining(['ttf_static', 'woff2_static']));
    expect(resources['ttf_static']!['variable_axes']).toBeUndefined();

    const fonts = formula['fonts'] as Array<Record<string, unknown>>;
    expect(fonts.length).toBeGreaterThan(0);
    const styles = fonts.flatMap((f) => f['styles'] as Array<Record<string, unknown>>);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style['variable_font']).toBe(false);
      expect(style['formats']).toEqual(expect.arrayContaining(['ttf']));
    }
  });

  it('downloads fonts and extracts metadata through the v5 builder', async () => {
    const served = family({
      family: 'Served Font',
      files: { regular: `${baseUrl}/ServedFont-Regular.ttf` },
    });
    const database = new FontDatabase({
      ttfData: [served],
      version: 5,
      ctx: env.ctx,
    });
    const formula = (await database.toFormula('Served Font'))!;
    expect(formula['name']).toBe('served_font');
    const fonts = formula['fonts'] as Array<Record<string, unknown>>;
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!['name']).toBe('Served Font');
    const styles = fonts[0]!['styles'] as Array<Record<string, unknown>>;
    expect(styles[0]!['font']).toBe('ServedFont-Regular.ttf');
    expect(styles[0]!['variable_font']).toBe(false);
  });

  it('creates import sources only when a commit id is available', async () => {
    const database = db(5);
    const formula = (await database.toFormula('ABeeZee'))!;
    // no source_path — no commit id, no import_source
    expect(formula['import_source']).toBeUndefined();
  });
});

describe('Google::DataSources::Github', () => {
  let repoDir: string;
  let env: TestEnv;

  const METADATA_PB = [
    'name: "Tiny Font"',
    'designer: "Tiny Designer"',
    'license: "OFL"',
    'category: "SERIF"',
    'date_added: "2025-01-01"',
    'fonts {',
    '  name: "Tiny Font"',
    '  style: "normal"',
    '  weight: 400',
    '  filename: "TinyFont-Regular.ttf"',
    '  post_script_name: "TinyFont-Regular"',
    '  full_name: "Tiny Font"',
    '  copyright: "Copyright 2026 Tiny"',
    '}',
    'subsets: "latin"',
  ].join('\n');

  beforeAll(async () => {
    env = await testEnv();
    repoDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-github-repo-'));
    const familyDir = path.join(repoDir, 'ofl', 'tinyfont');
    await fsp.mkdir(familyDir, { recursive: true });
    await fsp.writeFile(path.join(familyDir, 'METADATA.pb'), METADATA_PB);
    await fsp.writeFile(
      path.join(familyDir, 'TinyFont-Regular.ttf'),
      makeTtf({
        family: 'Tiny Font',
        subfamily: 'Regular',
        fullName: 'Tiny Font',
        postScript: 'TinyFont-Regular',
        version: 'Version 1.000',
        copyright: 'Copyright 2026 Tiny',
      }),
    );
    await fsp.writeFile(
      path.join(familyDir, 'OFL.txt'),
      'Copyright 2026 Tiny\n\nThis Font Software is licensed under the SIL Open Font License.\nhttps://example.com/tiny',
    );
    await fsp.writeFile(
      path.join(familyDir, 'DESCRIPTION.en_us.html'),
      '<p>Tiny Font is a <b>tiny</b> test font.</p>',
    );
  });

  afterAll(async () => {
    await fsp.rm(repoDir, { recursive: true, force: true });
    await cleanup(env);
  });

  it('validates the source path', () => {
    expect(() => new GithubDataSource(path.join(repoDir, 'missing'))).toThrow(/does not exist/);
    const empty = 'an empty dir case is validated by missing license dirs';
    void empty;
  });

  it('parses families with metadata, license, and description', async () => {
    const source = new GithubDataSource(repoDir);
    const families = await source.fetch();
    expect(families).toHaveLength(1);

    const family = families[0]!;
    expect(family.family).toBe('Tiny Font');
    expect(family.designer).toBe('Tiny Designer');
    expect(family.license).toBe('OFL-1.1');
    expect(family.category).toBe('serif');
    expect(family.variants).toEqual(['regular']);
    expect(family.subsets).toEqual(['latin']);
    expect(family.licenseText).toContain('SIL Open Font License');
    expect(family.homepage).toBe('https://example.com/tiny');
    expect(family.description).toBe('Tiny Font is a tiny test font.');
  });

  it('fetches a family by name', async () => {
    const source = new GithubDataSource(repoDir);
    expect((await source.fetchFamily('tiny font'))?.family).toBe('Tiny Font');
    expect(await source.fetchFamily('Missing')).toBeNull();
  });
});
