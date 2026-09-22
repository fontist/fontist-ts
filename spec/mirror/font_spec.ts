// Mirrors spec/fontist/font_spec.rb (Ruby gem): .all, .find, .install,
// .uninstall, .status, .list core behaviors with Ruby example names.
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Font } from '../../src/api/font.js';
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
  makeTtc,
  makeTtf,
  makeZip,
  testEnv,
  writeFormula,
  type TestEnv,
} from '../helpers/index.js';

let server: Server;
let baseUrl: string;
let requestCount = 0;
const envs: TestEnv[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount += 1;
    if (req.url?.endsWith('/collection.zip') && collectionZipPayload) {
      res.writeHead(200, { 'Content-Length': collectionZipPayload.length });
      res.end(collectionZipPayload);
      return;
    }
    if (req.url?.endsWith('/rename.zip') && renameZipPayload) {
      res.writeHead(200, { 'Content-Length': renameZipPayload.length });
      res.end(renameZipPayload);
      return;
    }
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

let renameZipPayload: Buffer | null = null;
let collectionZipPayload: Buffer | null = null;

async function serveRenameZip(data: Buffer): Promise<void> {
  renameZipPayload = makeZip([{ name: 'renamed_old.ttf', data }]);
}

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


  it('skips download when the font is already installed', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    requestCount = 0;
    const again = await Font.install('DejaVu Sans', env.ctx);
    expect(again).toHaveLength(1);
    expect(requestCount).toBe(0);
  });

  it('tells about fetching from cache', async () => {
    const env = await envWithDejavu();
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes' });
    env.ui.lines.length = 0;
    await Font.install('DejaVu Sans', env.ctx, { confirmation: 'yes', force: true });
    expect(env.ui.lines.join('\n')).toContain('Using cached file.');
  });

  it('detects, renames and installs the font (source_font)', async () => {
    const env = await testEnv();
    envs.push(env);
    const font = fontFileFor({ family: 'Renamed Sans', subfamily: 'Regular', fullName: 'Renamed Sans' });
    await writeFormula(env, 'renamed_sans', {
      name: 'Renamed Sans Formula',
      fonts: [
        {
          name: 'Renamed Sans',
          styles: [
            {
              family_name: 'Renamed Sans',
              type: 'Regular',
              full_name: 'Renamed Sans',
              post_script_name: 'RenamedSans',
              font: 'RenamedSans.ttf',
              source_font: 'renamed_old.ttf',
            },
          ],
        },
      ],
      resources: { 'r.zip': { urls: [`${baseUrl}/rename.zip`] } },
    });
    const { default: expressish } = { default: null };
    void expressish;
    await serveRenameZip(font.data);
    const paths = await Font.install('Renamed Sans', env.ctx, { confirmation: 'yes' });
    expect(paths[0]!.endsWith('RenamedSans.ttf')).toBe(true);
    await expect(fsp.access(paths[0]!)).resolves.toBeUndefined();
  });

  it('offers an interactive formula choice when the name misses', async () => {
    const env = await envWithDejavu();
    const { UI } = await import('../../src/ui/ui.js');
    const answers = ['0'];
    const promptLines: string[] = [];
    class PromptUi extends UI {
      constructor() {
        super({
          out: { write: (text: string) => promptLines.push(text) },
          err: { write: (text: string) => promptLines.push(text) },
          tty: false,
        });
      }
      override async ask(): Promise<string> {
        return answers.shift() ?? '';
      }
    }
    const { createContext } = await import('../../src/context.js');
    const promptCtx = await createContext(
      { FONTIST_PATH: env.ctx.paths.fontistPath() } as NodeJS.ProcessEnv,
      { ui: new PromptUi(), platform: 'macos' },
    );
    const paths = await Font.install('dejavu', promptCtx, {
      formula: 'dejavu-typo',
      interactive: true,
      confirmation: 'yes',
    });
    expect(paths).toHaveLength(1);
    const output = promptLines.join('\n');
    expect(output).toContain("Formula 'dejavu-typo' not found. Did you mean?");
    expect(output).toMatch(/\[0\] DejaVu/);
  });


  it('returns path of collection file', async () => {
    const env = await testEnv();
    envs.push(env);
    await writeFormula(env, 'collection_pack', {
      name: 'Collection Pack',
      font_collections: [
        {
          filename: 'Pack.ttc',
          fonts: [
            {
              name: 'Pack Face One',
              styles: [
                { family_name: 'Pack Face One', type: 'Regular', full_name: 'Pack Face One', font: 'Pack.ttc' },
              ],
            },
            {
              name: 'Pack Face Two',
              styles: [
                { family_name: 'Pack Face Two', type: 'Italic', full_name: 'Pack Face Two Italic', font: 'Pack.ttc' },
              ],
            },
          ],
        },
      ],
      resources: { 'c.zip': { urls: [`${baseUrl}/collection.zip`] } },
    });
    collectionZipPayload = makeZip([
      {
        name: 'Pack.ttc',
        data: makeTtc([
          { family: 'Pack Face One', subfamily: 'Regular', fullName: 'Pack Face One' },
          { family: 'Pack Face Two', subfamily: 'Italic', fullName: 'Pack Face Two Italic' },
        ]),
      },
    ]);
    const paths = await Font.install('Pack Face Two', env.ctx, { confirmation: 'yes' });
    expect(paths).toHaveLength(1);
    expect(paths[0]!.endsWith('Pack.ttc')).toBe(true);

    // Uninstalling by the non-first face's family removes the file.
    const removed = await Font.uninstall('Pack Face Two', env.ctx);
    expect(removed).toHaveLength(1);
    await expect(fsp.access(paths[0]!)).rejects.toBeTruthy();
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
