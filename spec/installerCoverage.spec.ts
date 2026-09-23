// Mirrors fontist/resources/google_resource_spec.rb, fontist/resources/apple_cdn_resource_spec.rb, fontist/resources/windows_fod_resource_spec.rb (Ruby gem): representative coverage.
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Font } from '../src/api/font.js';
import { Manifest } from '../src/api/manifest.js';
import { createContext } from '../src/context.js';
import { ManualFontError, FontistError } from '../src/errors/errors.js';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import { ResourceInstallerRegistry } from '../src/installer/resourceInstallers.js';
import { runCli } from '../src/cli/cli.js';
import { cleanup, fontFileFor, makeTtf, makeZip, testEnv, writeFormula, type TestEnv } from './helpers/index.js';

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];

const FONT = fontFileFor({ family: 'Spec Sans', subfamily: 'Regular', fullName: 'Spec Sans Regular' });

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/SpecSans-Regular.ttf') {
      res.writeHead(200, { 'Content-Length': FONT.data.length });
      res.end(FONT.data);
      return;
    }
    if (req.url?.endsWith('/spec.zip')) {
      const zip = makeZip([{ name: 'SpecSans-Regular.ttf', data: FONT.data }]);
      res.writeHead(200, { 'Content-Length': zip.length });
      res.end(zip);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

async function writeSpecFormula(e: TestEnv, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFormula(e, 'spec_sans', {
    name: 'Spec Sans Formula',
    schema_version: 5,
    fonts: [
      {
        name: 'Spec Sans',
        styles: [
          {
            family_name: 'Spec Sans',
            type: 'Regular',
            full_name: 'Spec Sans Regular',
            post_script_name: 'SpecSans-Regular',
            font: 'SpecSans-Regular.ttf',
          },
        ],
      },
    ],
    resources: { 'spec.zip': { urls: [`${baseUrl}/spec.zip`], format: 'ttf' } },
    ...extra,
  });
}

describe('Google resource installer', () => {
  it('downloads individual font files matched by source filename', async () => {
    const e = await env();
    await writeFormula(e, 'google_font', {
      name: 'Google Font Formula',
      schema_version: 5,
      fonts: [
        {
          name: 'Spec Sans',
          styles: [
            {
              family_name: 'Spec Sans',
              type: 'Regular',
              full_name: 'Spec Sans Regular',
              font: 'SpecSans-Regular.ttf',
            },
          ],
        },
      ],
      resources: {
        webfont: {
          source: 'google',
          files: [`${baseUrl}/SpecSans-Regular.ttf`],
          format: 'ttf',
        },
      },
    });
    const formula = (await new FormulaRepository(e.ctx).findByKey('google_font'))!;
    const { FontInstaller } = await import('../src/installer/fontInstaller.js');
    const installer = new FontInstaller(e.ctx, formula, { fontName: 'Spec Sans' });
    const installed = await installer.install('yes');
    expect(installed).toHaveLength(1);
    const content = await fsp.readFile(installed![0]!);
    expect(content).toEqual(FONT.data);
  });
});

describe('Apple CDN installer platform gate', () => {
  it('raises off macOS and is registered under apple_cdn', async () => {
    const e = await env();
    const { Resource } = await import('../src/formula/models.js');
    const resource = new Resource({
      name: 'cdn.zip',
      source: 'apple_cdn',
      urls: [`${baseUrl}/spec.zip`],
    });
    const registry = new ResourceInstallerRegistry();
    const linuxCtx = await createContext({ FONTIST_PATH: e.ctx.paths.fontistPath() } as NodeJS.ProcessEnv, {
      ui: e.ui,
      platform: 'linux',
    });
    const installer = registry.create('apple_cdn', linuxCtx, resource, { noProgress: true });
    await expect(installer.files([], async () => undefined)).rejects.toBeInstanceOf(
      FontistError,
    );
  });
});

describe('Manual formulas', () => {
  it('raises ManualFontError carrying the instructions', async () => {
    const e = await env();
    await writeFormula(e, 'manual_font', {
      name: 'Manual Font',
      description: 'Manual Font',
      instructions: 'Download it by hand from https://example.com',
      fonts: [
        {
          name: 'Manual Font',
          styles: [{ family_name: 'Manual Font', type: 'Regular', font: 'ManualFont.ttf' }],
        },
      ],
    });
    await expect(Font.find('Manual Font', e.ctx)).rejects.toThrow(/Download it by hand/);
    await expect(Font.find('Manual Font', e.ctx)).rejects.toBeInstanceOf(ManualFontError);
  });
});

describe('CLI formula mode (-F)', () => {
  it('installs a whole formula by key', async () => {
    const e = await env();
    await writeSpecFormula(e);
    const code = await runCli(
      ['install', 'spec_sans', '-F', '-a', '-p'],
      { FONTIST_PATH: e.ctx.paths.fontistPath() } as NodeJS.ProcessEnv,
      e.ui,
    );
    expect(code).toBe(0);
    const fontsDir = e.ctx.paths.fontsPath();
    const installed = await fsp.readdir(path.join(fontsDir, 'spec_sans'));
    expect(installed).toEqual(['SpecSans-Regular.ttf']);
  });
});

describe('Manifest format filtering', () => {
  it('locates matching formats and raises for unavailable ones', async () => {
    const e = await env();
    await writeSpecFormula(e);
    const fontBytes = makeTtf({ family: 'Spec Sans', subfamily: 'Regular', fullName: 'Spec Sans Regular' });
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    await fsp.writeFile(path.join(fontsDir, 'SpecSans-Regular.ttf'), fontBytes);

    const manifestPath = path.join(e.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, 'Spec Sans:\n  format: ttf\n');
    const manifest = await Manifest.fromFile(manifestPath);
    const located = await manifest.locate(e.ctx, { locations: true });
    expect(located[0]!.styles).toHaveLength(1);

    await fsp.writeFile(manifestPath, 'Spec Sans:\n  format: woff2\n');
    const woff2Manifest = await Manifest.fromFile(manifestPath);
    await expect(woff2Manifest.locate(e.ctx, { locations: true })).rejects.toThrow(/not installed/);
  });
});

describe('CLI --size-limit guard', () => {
  it('ignores non-numeric size limits instead of propagating NaN', async () => {
    const e = await env();
    await writeSpecFormula(e);
    const code = await runCli(
      ['install', 'Spec Sans', '-a', '-p', '-S', 'not-a-number'],
      { FONTIST_PATH: e.ctx.paths.fontistPath() } as NodeJS.ProcessEnv,
      e.ui,
    );
    expect(code).toBe(0);
    expect(e.ui.lines.join('\n')).toContain('Fonts installed at:');
  });
});
