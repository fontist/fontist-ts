// Mirrors spec/fontist/import/google/data_sources/base_spec.rb,
// spec/fontist/import/google/data_sources/ttf_spec.rb,
// spec/fontist/import/google/data_sources/vf_spec.rb,
// spec/fontist/import/google/data_sources/woff2_spec.rb,
// spec/fontist/import/google/api_spec.rb (Ruby gem).
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  BaseDataSource,
  TtfDataSource,
  VfDataSource,
  Woff2DataSource,
} from '../../src/import/google/dataSources/base.js';
import { GoogleApi } from '../../src/import/google/api.js';
import { FontFamily } from '../../src/import/google/models/fontFamily.js';
import { testEnv, cleanup, type TestEnv } from '../helpers/index.js';

const FIXTURES = path.join(__dirname, '..', '..', 'spec', 'fixtures', 'google_fonts');

describe('Google data sources', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('capability');
      const file =
        name === 'VF' ? 'vf.json' : name === 'WOFF2' ? 'woff2.json' : 'ttf.json';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(readFileSync(path.join(FIXTURES, file)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/webfonts/v1/webfonts`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const apiKey = 'test-key';

  it('sets the api key and capability', () => {
    const client = new BaseDataSource({ apiKey });
    expect(client.apiKey).toBe(apiKey);
    expect(client.capability).toBeNull();
    expect(new BaseDataSource({ apiKey, capability: 'VF' }).capability).toBe('VF');
  });

  it('builds the URL with api key and optional capability', () => {
    const url = new BaseDataSource({ apiKey, baseUrl }).url();
    expect(url).toContain(baseUrl);
    expect(url).toContain(`key=${apiKey}`);
    expect(url).not.toContain('capability');

    const vfUrl = new BaseDataSource({ apiKey, capability: 'VF' }).url();
    expect(vfUrl).toContain('capability=VF');
  });

  it('parses items into FontFamily models', () => {
    const raw = {
      kind: 'webfonts#webfontList',
      items: [
        {
          family: 'Test Family',
          variants: ['regular', 'italic'],
          subsets: ['latin'],
          version: 'v1',
          lastModified: '2025-01-01',
          files: { regular: 'https://example.com/font.ttf' },
          category: 'sans-serif',
          kind: 'webfonts#webfont',
          menu: 'https://example.com/menu.ttf',
        },
      ],
    };
    const families = new BaseDataSource({ apiKey }).parseResponse(raw);
    expect(families).toHaveLength(1);
    expect(families[0]).toBeInstanceOf(FontFamily);
    expect(families[0]!.family).toBe('Test Family');
    expect(families[0]!.variants).toEqual(['regular', 'italic']);
    expect(families[0]!.version).toBe('v1');
    expect(families[0]!.category).toBe('sans-serif');
  });

  it('handles empty or missing items', () => {
    const client = new BaseDataSource({ apiKey });
    expect(client.parseResponse({ kind: 'webfonts#webfontList', items: [] })).toEqual([]);
    expect(client.parseResponse({ kind: 'webfonts#webfontList' })).toEqual([]);
  });

  it('fetches, caches, and clears for each endpoint type', async () => {
    for (const make of [
      (key: string) => new TtfDataSource({ apiKey: key, baseUrl }),
      (key: string) => new VfDataSource({ apiKey: key, baseUrl }),
      (key: string) => new Woff2DataSource({ apiKey: key, baseUrl }),
    ]) {
      const client = make(apiKey);
      const families = await client.fetch();
      expect(families.length).toBeGreaterThan(0);
      expect(families[0]).toBeInstanceOf(FontFamily);
      // cached: identical array reference
      expect(await client.fetch()).toBe(families);
      client.clearCache();
      const refetched = await client.fetch();
      expect(refetched).not.toBe(families);
      expect(refetched).toHaveLength(families.length);
    }
  });

  it('raises for API failures', async () => {
    const client = new BaseDataSource({ apiKey, baseUrl: 'http://127.0.0.1:1/webfonts' });
    await expect(client.fetchRaw()).rejects.toThrow(/Failed to fetch from API/);
  });

  it('exposes endpoint capability constants', () => {
    expect(VfDataSource.CAPABILITY).toBe('VF');
    expect(Woff2DataSource.CAPABILITY).toBe('WOFF2');
  });
});

describe('Google::Api facade', () => {
  let env: TestEnv;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    env = await testEnv();
    server = createServer((req, res) => {
      const capability = new URL(req.url ?? '/', 'http://localhost').searchParams.get('capability');
      const file = capability === 'VF' ? 'vf.json' : capability === 'WOFF2' ? 'woff2.json' : 'ttf.json';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(readFileSync(path.join(FIXTURES, file)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/webfonts/v1/webfonts`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanup(env);
  });

  it('returns FontFamily objects through the merged database', async () => {
    const api = new GoogleApi({ apiKey: 'test-key', baseUrl, ctx: env.ctx });
    const fonts = await api.items();
    expect(Array.isArray(fonts)).toBe(true);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts[0]).toBeInstanceOf(FontFamily);
  });

  it('finds fonts with complete metadata', async () => {
    const api = new GoogleApi({ apiKey: 'test-key', baseUrl, ctx: env.ctx });
    const fonts = await api.items();
    const roboto = fonts.find((f) => f.family === 'Roboto');
    expect(roboto).toBeDefined();
    expect(roboto!.family).toBe('Roboto');
    expect(roboto!.category).not.toBeNull();
    expect(roboto!.variantNames().length).toBeGreaterThan(0);
    expect(Object.keys(roboto!.files()).length).toBeGreaterThan(0);
  });

  it('filters by category and variable fonts', async () => {
    const api = new GoogleApi({ apiKey: 'test-key', baseUrl, ctx: env.ctx });
    const sans = await api.byCategory('sans-serif');
    expect(sans.length).toBeGreaterThan(0);
    expect(sans.every((f) => f.category === 'sans-serif')).toBe(true);

    const variable = await api.variableFontsOnly();
    expect(variable.every((f) => f.variableFont())).toBe(true);
    const staticFonts = await api.staticFontsOnly();
    expect(staticFonts.every((f) => !f.variableFont())).toBe(true);

    const count = await api.fontsCount();
    expect(count.total).toBe(variable.length + staticFonts.length);
  });

  it('provides raw endpoint access', async () => {
    const api = new GoogleApi({ apiKey: 'test-key', baseUrl, ctx: env.ctx });
    expect((await api.ttfData()).length).toBeGreaterThan(0);
    expect((await api.vfData()).length).toBeGreaterThan(0);
    expect((await api.woff2Data()).length).toBeGreaterThan(0);
  });
});
