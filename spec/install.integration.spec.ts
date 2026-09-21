import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Font } from '../src/api/font.js';
import { Manifest } from '../src/api/manifest.js';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import type { FontistLocation, SystemLocation, UserLocation} from '../src/locations/installLocation.js';
import { createInstallLocation } from '../src/locations/installLocation.js';
import {
  LicensingError,
  MissingFontError,
  PlatformMismatchError,
  UnsupportedFontError,
} from '../src/errors/errors.js';
import { cleanup, fontFileFor, makeTtf, makeZip, testEnv, writeFormula, type TestEnv } from './helpers/index.js';

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];

const FONT_DATA = fontFileFor({
  family: 'Spec Sans',
  subfamily: 'Regular',
  fullName: 'Spec Sans Regular',
  postScript: 'SpecSans-Regular',
});

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/spec.zip')) {
      const zip = makeZip([{ name: 'SpecSans-Regular.ttf', data: FONT_DATA.data }]);
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

async function envWithFormula(extra: Record<string, unknown> = {}): Promise<TestEnv> {
  const env = await testEnv();
  envs.push(env);
  await writeFormula(env, 'spec_sans', {
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
    resources: {
      'spec.zip': {
        urls: [`${baseUrl}/spec.zip`],
        format: 'ttf',
      },
    },
    ...extra,
  });
  return env;
}

describe('install locations', () => {
  it('installs and uninstalls in the fontist location, keyed by formula', async () => {
    const env = await envWithFormula();
    const formula = (await new FormulaRepository(env.ctx).findByName('Spec Sans'))!;
    const location = createInstallLocation('fontist', env.ctx, formula) as FontistLocation;
    expect(location.basePath()).toContain(path.join('fonts', 'spec_sans'));
    const source = path.join(env.home, 'src.ttf');
    await fsp.writeFile(source, makeTtf({ family: 'Spec Sans', subfamily: 'Regular' }));
    const installed = await location.installFont(source, 'SpecSans-Regular.ttf');
    expect(installed).toContain('spec_sans');
    const removed = await location.uninstallFont('SpecSans-Regular.ttf');
    expect(removed).toBe(installed);
    expect(await location.uninstallFont('SpecSans-Regular.ttf')).toBeNull();
  });

  it('replaces fonts in managed locations and renames in unmanaged ones', async () => {
    const env = await envWithFormula();
    const formula = (await new FormulaRepository(env.ctx).findByName('Spec Sans'))!;
    const location = createInstallLocation('fontist', env.ctx, formula);
    const source = path.join(env.home, 'src.ttf');
    await fsp.writeFile(source, makeTtf({ family: 'X' }));
    const first = await location.installFont(source, 'Dup.ttf');
    const replaced = await location.installFont(source, 'Dup.ttf');
    expect(replaced).toBe(first);

    const custom = await testEnv();
    envs.push(custom);
    custom.ctx.config.set('user_fonts_path', path.join(custom.home, 'custom-user-fonts'));
    const userLocation = createInstallLocation('user', custom.ctx) as UserLocation;
    expect(userLocation.managedPath()).toBe(false);
    const userFirst = await userLocation.installFont(source, 'Dup.ttf');
    const userSecond = await userLocation.installFont(source, 'Dup.ttf');
    expect(userSecond).not.toBe(userFirst);
    expect(userSecond).toMatch(/fontist/);
  });

  it('warns about elevated permissions for system installs', async () => {
    const env = await envWithFormula();
    const location = createInstallLocation('system', env.ctx) as SystemLocation;
    expect(location.requiresElevatedPermissions()).toBe(true);
    expect(location.permissionWarning()).toContain('elevated');
    expect(location.basePath()).toMatch(/Fonts/);
  });
});

describe('FontInstaller pipeline', () => {
  it('downloads, extracts, and installs the formula fonts', async () => {
    const env = await envWithFormula();
    const formula = (await new FormulaRepository(env.ctx).findByName('Spec Sans'))!;
    const { FontInstaller } = await import('../src/installer/fontInstaller.js');
    const installer = new FontInstaller(env.ctx, formula, { fontName: 'Spec Sans' });
    const installed = await installer.install('yes');
    expect(installed).toHaveLength(1);
    const installedPath = installed![0]!;
    expect(installedPath).toContain('spec_sans');
    expect(installedPath.endsWith('SpecSans-Regular.ttf')).toBe(true);
    // registered in the fontist index
    const { FontistIndex } = await import('../src/index/installed/collectionIndexes.js');
    expect(await new FontistIndex(env.ctx).find('spec sans')).toHaveLength(1);
  });

  it('raises PlatformMismatchError for foreign platforms', async () => {
    const env = await envWithFormula({ platforms: ['windows'] });
    const formula = (await new FormulaRepository(env.ctx).findByName('Spec Sans'))!;
    const { FontInstaller } = await import('../src/installer/fontInstaller.js');
    const installer = new FontInstaller(env.ctx, formula, { fontName: 'Spec Sans' });
    await expect(installer.install('yes')).rejects.toBeInstanceOf(PlatformMismatchError);
  });

  it('enforces the license gate before installing', async () => {
    const env = await envWithFormula({ requires_license_agreement: 'CONTACT' });
    const formula = (await new FormulaRepository(env.ctx).findByName('Spec Sans'))!;
    const { FontInstaller } = await import('../src/installer/fontInstaller.js');
    const installer = new FontInstaller(env.ctx, formula, { fontName: 'Spec Sans' });
    await expect(installer.install(null)).rejects.toBeInstanceOf(LicensingError);
    const installed = await installer.install('YES');
    expect(installed).toHaveLength(1);
  });

  it('filters fonts subdirectories when extract options declare them', async () => {
    const env = await testEnv();
    envs.push(env);
    await writeFormula(env, 'subdir_font', {
      name: 'Subdir',
      schema_version: 5,
      extract: [{ options: [{ file: 'spec.zip', fonts_sub_dir: 'fonts/' }] }],
      fonts: [
        {
          name: 'Spec Sans',
          styles: [{ family_name: 'Spec Sans', type: 'Regular', full_name: 'Spec Sans Regular', font: 'SpecSans-Regular.ttf' }],
        },
      ],
      resources: { 'spec.zip': { urls: [`${baseUrl}/spec.zip`], format: 'ttf' } },
    });
    // The zip stores the font at the archive root, outside fonts/ -> nothing matches.
    const formula = (await new FormulaRepository(env.ctx).findByKey('subdir_font'))!;
    const { FontInstaller } = await import('../src/installer/fontInstaller.js');
    const installer = new FontInstaller(env.ctx, formula, { fontName: 'Spec Sans' });
    expect(await installer.install('yes')).toBeNull();
  });
});

describe('Font API', () => {
  it('raises UnsupportedFontError for unknown fonts', async () => {
    const env = await envWithFormula();
    await expect(Font.find('Unknown Font', env.ctx)).rejects.toBeInstanceOf(UnsupportedFontError);
  });

  it('raises MissingFontError for downloadable but uninstalled fonts on find', async () => {
    const env = await envWithFormula();
    await expect(Font.find('Spec Sans', env.ctx)).rejects.toBeInstanceOf(MissingFontError);
  });

  it('installs and then finds the font locally; uninstall removes it', async () => {
    const env = await envWithFormula();
    const installed = await Font.install('Spec Sans', env.ctx, { confirmation: 'yes' });
    expect(installed).toHaveLength(1);

    const found = await Font.find('Spec Sans', env.ctx);
    expect(found).toEqual(installed);

    // Installed fonts short-circuit a second install.
    const again = await Font.install('Spec Sans', env.ctx);
    expect(again).toEqual(installed);

    const removed = await Font.uninstall('Spec Sans', env.ctx);
    expect(removed).toHaveLength(1);
    await expect(Font.find('Spec Sans', env.ctx)).rejects.toBeInstanceOf(MissingFontError);
  });

  it('installMany reports successes and failures', async () => {
    const env = await envWithFormula();
    const result = await Font.installMany(['Spec Sans', 'Ghost Font'], env.ctx, { confirmation: 'yes' });
    expect(result.successes).toEqual(['Spec Sans']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.font).toBe('Ghost Font');
  });

  it('lists installation status per formula/font/style', async () => {
    const env = await envWithFormula();
    await Font.install('Spec Sans', env.ctx, { confirmation: 'yes' });
    const list = await Font.list('Spec Sans', env.ctx);
    expect(list['spec_sans']?.['Spec Sans']?.['Regular']).toBe(true);
    const all = await Font.list(null, env.ctx);
    expect(Object.keys(all)).toContain('spec_sans');
  });

  it('status without a name returns visible font paths', async () => {
    const env = await envWithFormula();
    const paths = await Font.status(null, env.ctx);
    expect(Array.isArray(paths)).toBe(true);
  });
});

describe('Manifest', () => {
  it('locates installed fonts and reports missing ones', async () => {
    const env = await envWithFormula();
    await Font.install('Spec Sans', env.ctx, { confirmation: 'yes' });
    const manifestYaml = yaml.stringify({ 'Spec Sans': { styles: ['Regular'] } });
    const manifestPath = path.join(env.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, manifestYaml);
    const manifest = await Manifest.fromFile(manifestPath);
    const response = await manifest.locate(env.ctx, { locations: true });
    expect(response[0]!.name).toBe('Spec Sans');
    expect(response[0]!.styles[0]!.paths).toHaveLength(1);
    expect(response[0]!.styles[0]!.fullName).toBe('Spec Sans Regular');
  });

  it('raises ManifestCouldNotBeFoundError for missing files', async () => {
    const env = await envWithFormula();
    const missing = path.join(env.home, 'nope.yml');
    await expect(Manifest.fromFile(missing)).rejects.toThrow(/not found/);
    const empty = path.join(env.home, 'empty.yml');
    await fsp.writeFile(empty, '');
    await expect(Manifest.fromFile(empty)).rejects.toThrow(/empty/);
  });

  it('installs every font declared in the manifest', async () => {
    const env = await envWithFormula();
    const manifestPath = path.join(env.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, yaml.stringify({ 'Spec Sans': null }));
    const manifest = await Manifest.fromFile(manifestPath);
    const response = await manifest.install(env.ctx, { confirmation: 'yes' });
    expect(response[0]!.styles[0]!.paths).toHaveLength(1);
  });
});
