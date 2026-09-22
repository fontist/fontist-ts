// Mirrors spec/fontist/font_installer_spec.rb +
// spec/fontist/font_license_confirmation_spec.rb (Ruby gem).
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormulaRepository } from '../../src/formula/formulaRepository.js';
import { FontInstaller } from '../../src/installer/fontInstaller.js';
import {
  FontistVersionError,
  LicensingError,
  PlatformMismatchError,
  TranscodeLicenseNotAcceptedError,
} from '../../src/errors/errors.js';
import { FormatSpec } from '../../src/formula/formatSpec.js';
import { fontFileFor, makeZip, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/installer.zip')) {
      const font = fontFileFor({ family: 'Installer Sans', subfamily: 'Regular', fullName: 'Installer Sans' });
      const zip = makeZip([{ name: 'InstallerSans.ttf', data: font.data }]);
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

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  await writeFormula(e, 'installer_sans', {
    name: 'Installer Sans Formula',
    fonts: [
      {
        name: 'Installer Sans',
        styles: [
          {
            family_name: 'Installer Sans',
            type: 'Regular',
            full_name: 'Installer Sans',
            post_script_name: 'InstallerSans',
            font: 'InstallerSans.ttf',
          },
        ],
      },
    ],
    resources: { 'i.zip': { urls: [`${baseUrl}/installer.zip`] } },
  });
  return e;
}

async function formula(e: TestEnv) {
  return (await new FormulaRepository(e.ctx).findByKey('installer_sans'))!;
}

describe('FontInstaller gates', () => {
  it('raises PlatformMismatchError for foreign platforms', async () => {
    const e = await testEnv({ platform: 'windows' });
    envs.push(e);
    await writeFormula(e, 'installer_sans', {
      name: 'Installer Sans Formula',
      platforms: ['macos'],
      fonts: [
        { name: 'Installer Sans', styles: [{ family_name: 'Installer Sans', type: 'Regular', font: 'InstallerSans.ttf' }] },
      ],
      resources: { 'i.zip': { urls: ['https://example.invalid/i.zip'] } },
    });
    const installer = new FontInstaller(e.ctx, (await new FormulaRepository(e.ctx).findByKey('installer_sans'))!, {
      fontName: 'Installer Sans',
    });
    await expect(installer.install('yes')).rejects.toBeInstanceOf(PlatformMismatchError);
  });

  it('raises FontistVersionError when min_fontist exceeds current', async () => {
    const e = await env();
    await writeFormula(e, 'future_font', {
      name: 'Future',
      min_fontist: '99.0',
      fonts: [
        { name: 'Installer Sans', styles: [{ family_name: 'Installer Sans', type: 'Regular', font: 'InstallerSans.ttf' }] },
      ],
      resources: { 'f.zip': { urls: [`${baseUrl}/installer.zip`] } },
    });
    const installer = new FontInstaller(e.ctx, (await new FormulaRepository(e.ctx).findByKey('future_font'))!, {
      fontName: 'Installer Sans',
    });
    await expect(installer.install('yes')).rejects.toBeInstanceOf(FontistVersionError);
  });

  it('raises LicensingError without confirmation and installs with yes', async () => {
    const e = await env();
    await writeFormula(e, 'licensed_font', {
      name: 'Licensed',
      requires_license_agreement: 'AGREE',
      fonts: [
        { name: 'Installer Sans', styles: [{ family_name: 'Installer Sans', type: 'Regular', font: 'InstallerSans.ttf' }] },
      ],
      resources: { 'l.zip': { urls: [`${baseUrl}/installer.zip`] } },
    });
    const licensed = (await new FormulaRepository(e.ctx).findByKey('licensed_font'))!;
    const noLicense = new FontInstaller(e.ctx, licensed, { fontName: 'Installer Sans' });
    await expect(noLicense.install(null)).rejects.toBeInstanceOf(LicensingError);
    const withLicense = new FontInstaller(e.ctx, licensed, { fontName: 'Installer Sans' });
    expect(await withLicense.install('yes')).toHaveLength(1);
  });

  it('installs the font file with the declared target name', async () => {
    const e = await env();
    const installer = new FontInstaller(e.ctx, await formula(e), { fontName: 'Installer Sans' });
    const installed = await installer.install('yes');
    expect(installed![0]!.endsWith('InstallerSans.ttf')).toBe(true);
    await expect(fsp.access(installed![0]!)).resolves.toBeUndefined();
  });
});

describe('Transcode license gate', () => {
  it('requires license acceptance before conversion', async () => {
    const { checkTranscodeLicense } = await import('../../src/installer/transcode.js');
    expect(() => checkTranscodeLicense(null)).toThrow(TranscodeLicenseNotAcceptedError);
    expect(() => checkTranscodeLicense('yes')).not.toThrow();
  });

  it('reports installation strategies against available formats', async () => {
    const { FormatMatcher: Matcher } = await import('../../src/formula/formatMatcher.js');
    const matcher = new Matcher(new FormatSpec({ format: 'woff2' }));
    expect(matcher.installationStrategy(['ttf'])).toEqual({ strategy: 'convert', from: 'ttf', to: 'woff2' });
  });
});
