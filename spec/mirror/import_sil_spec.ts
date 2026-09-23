// Mirrors spec/fontist/import/sil_importer_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import type { Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SilImporter,
  extractVersionFromUrl,
} from '../../src/import/silImporter.js';
import { SilImportSource } from '../../src/formula/importSources.js';
import { extractAnchors, anchorsMatchingSelector } from '../../src/import/helpers/htmlWalk.js';
import { makeTtf, makeZip, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

const FONTS_PAGE = [
  '<html><body>',
  '<table class="products"><tr><td>',
  '<div class="title"><a href="/charis/">Charis SIL</a></div>',
  '</td></tr><tr><td>',
  '<div class="title"><a href="/andika/">Andika</a></div>',
  '</td></tr><tr><td>',
  '<div class="title"><a href="/arabic/">Arabic Fonts</a></div>',
  '</td></tr></table>',
  '</body></html>',
].join('');

const CHARIS_PAGE = [
  '<html><body>',
  // Relative archive link so it resolves against the (remapped) page URL and
  // stays on the local fake server — tests must never touch the network.
  '<a class="btn-download" href="/downloads/r/charis/CharisSIL-6.200.zip">Download</a>',
  '<a class="btn-download" href="/charis/downloads/">DOWNLOADS</a>',
  '</body></html>',
].join('');

describe('SilImporter', () => {
  let env: TestEnv;
  let outputDir: string;
  let archiveBytes: Buffer;

  beforeAll(async () => {
    env = await testEnv();
    outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-sil-out-'));
    archiveBytes = makeZip([
      {
        name: 'CharisSIL-Regular.ttf',
        data: makeTtf({
          family: 'Charis SIL',
          subfamily: 'Regular',
          fullName: 'Charis SIL',
          postScript: 'CharisSIL-Regular',
          version: 'Version 6.200',
          copyright: 'Copyright (c) SIL International',
        }),
      },
      { name: 'OFL.txt', data: Buffer.from('SIL Open Font License text') },
    ]);

    // Local fake of the SIL website (fetchPage injection)
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url.endsWith('.zip')) {
        res.writeHead(200, { 'content-type': 'application/zip' });
        res.end(archiveBytes);
        return;
      }
      if (url.startsWith('/charis/')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(CHARIS_PAGE);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FONTS_PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    (env as TestEnv & { silServer?: Server; silBase?: string }).silServer = server;
    (env as TestEnv & { silBase?: string }).silBase = base;
  });

  afterAll(async () => {
    const extended = env as TestEnv & { silServer?: Server };
    if (extended.silServer) {
      await new Promise<void>((resolve) => extended.silServer!.close(() => resolve()));
    }
    await fsp.rm(outputDir, { recursive: true, force: true });
    await cleanup(env);
  });

  function makeImporter(options: Record<string, unknown> = {}): SilImporter {
    const base = (env as TestEnv & { silBase?: string }).silBase!;
    return new SilImporter(env.ctx, {
      outputPath: outputDir,
      rootUrl: base,
      ...options,
    });
  }

  it('accepts output_path and font_name options', () => {
    expect(makeImporter()).toBeInstanceOf(SilImporter);
    expect(makeImporter({ fontName: 'Charis' }).call).toBeTypeOf('function');
  });

  it('finds archive links and creates formulas', async () => {
    const result = await makeImporter({ fontName: 'charis' }).call();
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['successful', 'failed', 'duration', 'errors']),
    );
  });

  it('creates versioned formulas with the SIL import source', async () => {
    await makeImporter({ fontName: 'charis' }).call();
    // SIL formula filenames are versioned: name_version.yml
    const files = await fsp.readdir(outputDir);
    expect(files).toContain('charis_sil_6.200.yml');
    const { parse: parseYaml } = await import('yaml');
    const formula = parseYaml(await fsp.readFile(path.join(outputDir, 'charis_sil_6.200.yml'), 'utf8'));
    expect(formula['name']).toBe('Charis SIL');
    expect(formula['import_source']['type']).toBe('sil');
    expect(formula['import_source']['version']).toBe('6.200');
    expect(formula['import_source']['release_date']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('skips existing formulas unless forced', async () => {
    const first = await makeImporter({ fontName: 'charis' }).call();
    expect(first.successful).toBe(1);
    // Backdate the formula's mtime so the importer's 2s "just created"
    // heuristic does not mask the skip.
    const formulaPath = path.join(outputDir, 'charis_sil_6.200.yml');
    const old = new Date(Date.now() - 60_000);
    await fsp.utimes(formulaPath, old, old);
    const second = await makeImporter({ fontName: 'charis' }).call();
    expect(second.skipped).toBe(1);
    expect(second.successful).toBe(0);
    const forced = await makeImporter({ fontName: 'charis', force: true }).call();
    expect(forced.successful).toBe(1);
  });

  it('filters links by font name case-insensitively', async () => {
    const noMatch = await makeImporter({ fontName: 'nonexistent' }).call();
    expect(noMatch.successful).toBe(0);
  });

  it('skips index pages', async () => {
    // 'Arabic Fonts' is an index page; only Charis should be attempted
    const result = await makeImporter().call();
    expect(result.successful + result.skipped).toBe(1);
  });

  it('returns an empty result when no links found', async () => {
    const importer = makeImporter();
    const empty = new SilImporter(env.ctx, {
      outputPath: outputDir,
      fetchPage: async () => '<html><body></body></html>',
    });
    void importer;
    const result = await empty.call();
    expect(result).toEqual({ successful: 0, failed: 0, skipped: 0, overwritten: 0, errors: [], duration: 0 });
  });
});

describe('extract_version_from_url', () => {
  it('extracts versions from standard SIL URL formats', () => {
    expect(extractVersionFromUrl('https://software.sil.org/downloads/r/charis/CharisSIL-6.200.zip')).toBe('6.200');
    expect(extractVersionFromUrl('https://example.com/fonts/Andika-6.101.zip')).toBe('6.101');
    expect(extractVersionFromUrl('https://example.com/fonts/Font_1.5.2.zip')).toBe('1.5.2');
    expect(extractVersionFromUrl('https://example.com/fonts/Font-2.1.tar.gz')).toBe('2.1');
    expect(extractVersionFromUrl('https://example.com/fonts/Font-v3.0.zip')).toBe('3.0');
    expect(extractVersionFromUrl('https://example.com/fonts/SomeFont.zip')).toBeNull();
  });
});

describe('create_import_source', () => {
  it('creates a SilImportSource with version and release date', () => {
    // createImportSource is module-private; verify via the exported model
    const source = new SilImportSource({ type: 'sil', version: '6.200', release_date: '2026-09-23T00:00:00Z' });
    expect(source.version).toBe('6.200');
    expect(source.differentiationKey()).toBe('6.200');
  });
});

describe('HTML anchor extraction', () => {
  it('matches table.products div.title > a', () => {
    const anchors = extractAnchors(FONTS_PAGE);
    const found = anchorsMatchingSelector(anchors, 'table.products div.title > a');
    expect(found.map((a) => a.text)).toEqual(['Charis SIL', 'Andika', 'Arabic Fonts']);
  });

  it('matches a.btn-download and a.getfile', () => {
    const anchors = extractAnchors(CHARIS_PAGE);
    expect(anchorsMatchingSelector(anchors, 'a.btn-download')).toHaveLength(2);
    expect(anchorsMatchingSelector(anchors, 'a.getfile')).toHaveLength(0);
  });
});
