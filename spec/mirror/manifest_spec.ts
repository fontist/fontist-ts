// Mirrors spec/fontist/manifest_spec.rb (Ruby gem).
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Manifest } from '../../src/api/manifest.js';
import {
  ManifestCouldNotBeFoundError,
  ManifestCouldNotBeReadError,
  MissingFontError,
} from '../../src/errors/errors.js';
import { fontFileFor, makeTtf, makeZip, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

let baseUrl = '';

const server: Server = createServer((req, res) => {
  void req;
  const font = fontFileFor({ family: 'Mani Font', subfamily: 'Regular', fullName: 'Mani Font Regular' });
  const zip = makeZip([{ name: 'ManiFont.ttf', data: font.data }]);
  res.writeHead(200, { 'Content-Length': zip.length });
  res.end(zip);
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  await writeFormula(e, 'mani_font', {
    fonts: [
      { name: 'Mani Font', styles: [{ family_name: 'Mani Font', type: 'Regular', full_name: 'Mani Font Regular', font: 'ManiFont.ttf' }] },
    ],
    resources: { 'm.zip': { urls: [`${baseUrl}/m.zip`] } },
  });
  return e;
}

describe('Manifest', () => {
  it('raises ManifestCouldNotBeFoundError for a missing file', async () => {
    const e = await env();
    await expect(Manifest.fromFile(path.join(e.home, 'nope.yml'))).rejects.toBeInstanceOf(
      ManifestCouldNotBeFoundError,
    );
  });

  it('raises ManifestCouldNotBeReadError for an empty file', async () => {
    const e = await env();
    const empty = path.join(e.home, 'empty.yml');
    await fsp.writeFile(empty, '');
    await expect(Manifest.fromFile(empty)).rejects.toBeInstanceOf(ManifestCouldNotBeReadError);
  });

  it('locates installed fonts by styles', async () => {
    const e = await env();
    const fontsDir = e.ctx.paths.fontsPath();
    await fsp.mkdir(fontsDir, { recursive: true });
    await fsp.writeFile(
      path.join(fontsDir, 'ManiFont.ttf'),
      makeTtf({ family: 'Mani Font', subfamily: 'Regular', fullName: 'Mani Font Regular' }),
    );
    const manifestPath = path.join(e.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, 'Mani Font:\n  styles:\n    - Regular\n');
    const manifest = await Manifest.fromFile(manifestPath);
    const located = await manifest.locate(e.ctx, { locations: true });
    expect(located[0]!.styles[0]!.paths).toHaveLength(1);
    expect(located[0]!.styles[0]!.type).toBe('Regular');
  });

  it('raises MissingFontError with locations mode for unmet fonts', async () => {
    const e = await env();
    const manifestPath = path.join(e.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, 'Mani Font:\n');
    const manifest = await Manifest.fromFile(manifestPath);
    await expect(manifest.locate(e.ctx, { locations: true })).rejects.toBeInstanceOf(MissingFontError);
  });

  it('installs fonts from the manifest', async () => {
    const e = await env();
    const manifestPath = path.join(e.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, 'Mani Font:\n');
    const manifest = await Manifest.fromFile(manifestPath);
    const located = await manifest.install(e.ctx, { confirmation: 'yes', interactive: false });
    expect(located[0]!.styles[0]!.paths).toHaveLength(1);
  });
});
