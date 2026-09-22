// Mirrors spec/fontist/font_spec.rb (Ruby gem): .all, .find, .install,
// .uninstall, .status, .list core behaviors with Ruby example names.
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Font } from '../../src/api/font.js';
import { FormulaRepository } from '../../src/formula/formulaRepository.js';
import { FontModel } from '../../src/formula/models.js';
import {
  FontistVersionError,
  LicensingError,
  ManualFontError,
  MissingFontError,
  SizeLimitError,
  UnsupportedFontError,
} from '../../src/errors/errors.js';
import {
  cleanup,
  fontFileFor,
  makeTtf,
  makeZip,
  testEnv,
  writeFormula,
  type TestEnv,
} from '../helpers/index.js';

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/mirror.zip')) {
      const font = fontFileFor({ family: 'DejaVu Sans', subfamily: 'Regular', fullName: 'DejaVu Sans' });
      const zip = makeZip([{ name: 'DejaVuSans.ttf', data: font.data }]);
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

async function envWithDejavu(extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = await testEnv();
  envs.push(env);
  await writeFormula(env, 'dejavu', {
    name: 'DejaVu',
    fonts: [
      {
        name: 'DejaVu Sans',
        styles: [
          {
            family_name: 'DejaVu Sans',
            type: 'Regular',
            full_name: 'DejaVu Sans',
            post_script_name: 'DejaVuSans',
            font: 'DejaVuSans.ttf',
          },
        ],
      },
    ],
    resources: { 'dejavu.zip': { urls: [`${baseUrl}/mirror.zip`] } },
    ...extra,
  });
  return env;
}

describe('.all', () => {
  it('lists all supported fonts', async () => {
    const env = await envWithDejavu();
    const fonts = await Font.all(env.ctx);
    expect(fonts[0]).toBeInstanceOf(FontModel);
    expect(fonts[0]!.name).toBe('DejaVu Sans');
  });
});

describe('.find', () => {
  it('returns the fonts path when installed', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const paths = await Font.find('DejaVu Sans', env.ctx);
    expect(paths[0]).toContain('dejavu');
  });

  it('raises font missing error for downloadable fonts', async () => {
    const env = await envWithDejavu();
    await expect(Font.find('DejaVu Sans', env.ctx)).rejects.toBeInstanceOf(MissingFontError);
  });

  it('raises font unsupported error', async () => {
    const env = await envWithDejavu();
    await expect(Font.find('Nonexistent Font', env.ctx)).rejects.toBeInstanceOf(UnsupportedFontError);
  });

  it('raises manual font error', async () => {
    const env = await envWithDejavu();
    await writeFormula(env, 'manual_only', {
      name: 'Manual',
      instructions: 'Fetch it yourself',
      fonts: [
        { name: 'Manual Font', styles: [{ family_name: 'Manual Font', type: 'Regular', font: 'MF.ttf' }] },
      ],
    });
    await expect(Font.find('Manual Font', env.ctx)).rejects.toBeInstanceOf(ManualFontError);
  });
});

describe('.install', () => {
  it('installs and returns paths for fonts with open license', async () => {
    const env = await envWithDejavu();
    const paths = await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    expect(paths).toHaveLength(1);
    await expect(fsp.access(paths[0]!)).resolves.toBeUndefined();
  });

  it('raises licensing error when confirmation is not yes', async () => {
    const env = await envWithDejavu({ requires_license_agreement: 'READ ME' });
    await expect(Font.install('DejaVu Sans', env.ctx, { interactive: false })).rejects.toBeInstanceOf(
      LicensingError,
    );
  });

  it('returns the existing font paths when already installed', async () => {
    const env = await envWithDejavu();
    const first = await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const second = await Font.install('DejaVu Sans', env.ctx);
    expect(second).toEqual(first);
  });

  it('installs font anyway when force is set', async () => {
    const env = await envWithDejavu();
    const first = await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const forced = await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes', force: true });
    expect(forced).toHaveLength(1);
    expect(path.dirname(forced[0]!)).toBe(path.dirname(first[0]!));
  });

  it('raises FontistVersionError for formulas needing newer fontist', async () => {
    const env = await envWithDejavu({ min_fontist: '99.0' });
    await expect(Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' })).rejects.toBeInstanceOf(
      FontistVersionError,
    );
  });

  it('raises size-limit error when everything exceeds the limit', async () => {
    const env = await envWithDejavu();
    await fsp.rm(path.join(env.ctx.paths.formulasPath(), 'dejavu.yml'));
    await writeFormula(env, 'huge', {
      name: 'Huge',
      fonts: [
        { name: 'DejaVu Sans', styles: [{ family_name: 'DejaVu Sans', type: 'Regular', font: 'D.ttf' }] },
      ],
      resources: { 'h.zip': { urls: [`${baseUrl}/mirror.zip`], file_size: 500 * 1024 * 1024 } },
    });
    await expect(
      Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes', sizeLimitMb: 1 }),
    ).rejects.toBeInstanceOf(SizeLimitError);
  });

  it('tells that font found locally', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    env.ui.lines.length = 0;
    await Font.install('DejaVu Sans', env.ctx);
    expect(env.ui.lines.join('\n')).toContain('Fonts found at:');
  });

  it('installs by default family', async () => {
    const env = await envWithDejavu();
    const paths = await Font.install('dejavu sans', env.ctx, { confirmation: 'yes' });
    expect(paths).toHaveLength(1);
  });
});

describe('.uninstall', () => {
  it('raises font unsupported error for unknown fonts', async () => {
    const env = await envWithDejavu();
    await expect(Font.uninstall('Nonexistent Font', env.ctx)).rejects.toBeInstanceOf(UnsupportedFontError);
  });

  it('raises font missing error when installed font is absent', async () => {
    const env = await envWithDejavu();
    await expect(Font.uninstall('DejaVu Sans', env.ctx)).rejects.toBeInstanceOf(MissingFontError);
  });

  it('removes the installed font', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const removed = await Font.uninstall('DejaVu Sans', env.ctx);
    expect(removed).toHaveLength(1);
    await expect(fsp.access(removed[0]!)).rejects.toBeTruthy();
  });
});

describe('.status and .list', () => {
  it('reports installed paths by name', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const paths = await Font.status('DejaVu Sans', env.ctx);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('lists installation state per style', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const list = await Font.list('DejaVu Sans', env.ctx);
    expect(list.dejavu?.['DejaVu Sans']?.Regular).toBe(true);
  });

  it('lists uninstalled state for missing fonts', async () => {
    const env = await envWithDejavu();
    const list = await Font.list('DejaVu Sans', env.ctx);
    expect(list.dejavu?.['DejaVu Sans']?.Regular).toBe(false);
  });
});

describe('installed font data', () => {
  it('re-parses installed font metadata through FontFile', async () => {
    const env = await envWithDejavu();
    const paths = await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    const { FontFile } = await import('../../src/fonts/fontFile.js');
    const font = await FontFile.fromPath(paths[0]!);
    expect(font.familyName).toBe('DejaVu Sans');
    void makeTtf;
  });
});
