// Mirrors spec/fontist/import/macos_spec.rb,
// spec/fontist/macos/catalog/asset_spec.rb,
// spec/fontist/macos/catalog/base_parser_spec.rb,
// spec/fontist/macos/catalog/catalog_manager_spec.rb,
// spec/fontist/macos/catalog/font7_parser_spec.rb,
// spec/fontist/macos/catalog/font8_parser_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogAsset } from '../../src/import/macos/catalog/asset.js';
import {
  CatalogManager,
  Font8CatalogParser,
  Font7CatalogParser,
} from '../../src/import/macos/catalog/catalogManager.js';
import { BaseCatalogParser } from '../../src/import/macos/catalog/baseParser.js';
import {
  macosFrameworkCompatibleWith,
  macosFrameworkForMacos,
  macosFrameworkMaxVersion,
  macosFrameworkMinVersion,
} from '../../src/import/macos/frameworkMetadata.js';
import { ArgumentError } from '../../src/import/macos/catalog/baseParser.js';

function plistXml(options: {
  version: number;
  postedDate: string;
  assets: Array<Record<string, unknown>>;
}): string {
  const assets = options.assets
    .map((asset) => {
      const entries = Object.entries(asset)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            const items = value
              .map((v) => `        <string>${v}</string>`)
              .join('\n');
            return `    <key>${key}</key>\n    <array>\n${items}\n    </array>`;
          }
          return `    <key>${key}</key>\n    <string>${value}</string>`;
        })
        .join('\n');
      return `  <dict>\n${entries}\n  </dict>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>postedDate</key>
  <date>${options.postedDate}</date>
  <key>Assets</key>
  <array>
${assets}
  </array>
</dict>
</plist>
`;
}

const POSTED = '2022-04-13T09:41:00Z';

function sampleAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __BaseURL: 'https://updates.cdn-apple.com/2022/mobileassets/',
    __RelativePath: 'com_apple_MobileAsset_Font7/701405507c8753373648c7a6541608e32ed089ec.zip',
    Build: '701405507C8753373648C7A6541608E32ED089EC',
    _CompatibilityVersion: '1',
    FontInfo4: [
      {
        PostScriptFontName: 'AlBayan',
        FontFamilyName: 'Al Bayan',
        FontStyleName: 'Plain',
        PreferredFamilyName: 'Al Bayan',
        PreferredStyleName: 'Regular',
      },
    ],
    ...overrides,
  };
}

async function writeCatalog(
  dir: string,
  version: number,
  assets: Array<Record<string, unknown>>,
  postedDate = POSTED,
): Promise<string> {
  const versionDir = path.join(dir, `com_apple_MobileAsset_Font${version}`);
  await fsp.mkdir(versionDir, { recursive: true });
  const filePath = path.join(versionDir, `com_apple_MobileAsset_Font${version}.xml`);
  await fsp.writeFile(filePath, plistXml({ version, postedDate, assets }));
  return filePath;
}

describe('Macos::Catalog::Asset', () => {
  it('exposes download urls, fonts, and families', () => {
    const asset = new CatalogAsset(sampleAsset() as never, {
      postedDate: POSTED,
      frameworkVersion: 7,
    });
    expect(asset.downloadUrl()).toBe(
      'https://updates.cdn-apple.com/2022/mobileassets/com_apple_MobileAsset_Font7/701405507c8753373648c7a6541608e32ed089ec.zip',
    );
    expect(asset.fonts()).toHaveLength(1);
    expect(asset.postscriptNames()).toEqual(['AlBayan']);
    expect(asset.fontFamilies()).toEqual(['Al Bayan']);
    expect(asset.primaryFamilyName()).toBe('Al Bayan');
  });

  it('derives the asset id from Build (Font7/8) or the relative path (Font5/6)', () => {
    const withBuild = new CatalogAsset(sampleAsset() as never, { frameworkVersion: 7 });
    expect(withBuild.assetId()).toBe('701405507c8753373648c7a6541608e32ed089ec');

    const withoutBuild = new CatalogAsset(
      sampleAsset({ Build: undefined, __RelativePath: 'com_apple_MobileAsset_Font5/94AF53B6DD43B085554E207F5CD282FDE8367AF6.zip' }) as never,
      { frameworkVersion: 5 },
    );
    expect(withoutBuild.assetId()).toBe('94af53b6dd43b085554e207f5cd282fde8367af6');
  });

  it('builds a MacosImportSource init when all fields exist', () => {
    const asset = new CatalogAsset(sampleAsset() as never, {
      postedDate: POSTED,
      frameworkVersion: 7,
    });
    const source = asset.toImportSource();
    expect(source).toEqual({
      framework_version: 7,
      posted_date: POSTED,
      asset_id: '701405507c8753373648c7a6541608e32ed089ec',
    });

    const bare = new CatalogAsset({ __BaseURL: 'x', __RelativePath: 'y' } as never, {
      frameworkVersion: 7,
    });
    expect(bare.toImportSource()).toBeNull();
  });

  it('checks macOS compatibility per font (PlatformDelivery)', () => {
    const asset = new CatalogAsset(
      sampleAsset({
        FontInfo4: [
          { FontFamilyName: 'A', PlatformDelivery: ['macOS'] },
          { FontFamilyName: 'B', PlatformDelivery: ['macOS-invisible'] },
          { FontFamilyName: 'C' },
        ],
      }) as never,
    );
    const fonts = asset.fonts();
    expect(fonts[0]!.macosCompatible()).toBe(true);
    expect(fonts[1]!.macosCompatible()).toBe(false);
    expect(fonts[2]!.macosCompatible()).toBe(true);
  });
});

describe('Macos::Catalog::BaseParser', () => {
  let dir: string;
  let catalogPath: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-catalog-'));
    catalogPath = await writeCatalog(dir, 7, [sampleAsset()]);
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('parses assets with posted date and framework version', () => {
    const parser = new BaseCatalogParser(catalogPath);
    const assets = parser.assets();
    expect(assets).toHaveLength(1);
    expect(parser.postedDate()).toBe('2022-04-13T09:41:00Z');
    expect(parser.frameworkVersion()).toBe(7);
    expect(parser.catalogVersion()).toBe(7);
    expect(assets[0]!.postedDate).toBe('2022-04-13T09:41:00Z');
    expect(assets[0]!.frameworkVersion).toBe(7);
  });

  it('raises when the version cannot be detected', () => {
    expect(() => CatalogManager.detectVersion('/path/without/version.xml')).toThrow(ArgumentError);
  });
});

describe('Macos::Catalog::Font7/Font8 parsers', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-catalog-f78-'));
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('Font7 keeps all assets', async () => {
    const catalogPath = await writeCatalog(dir, 7, [
      sampleAsset(),
      sampleAsset({ Build: 'B2', PlatformDelivery: ['iOS'] }),
    ]);
    expect(new Font7CatalogParser(catalogPath).assets()).toHaveLength(2);
  });

  it('Font8 filters non-macOS assets', async () => {
    const catalogPath = await writeCatalog(dir, 8, [
      sampleAsset({ Build: 'A1' }),
      sampleAsset({ Build: 'B2', PlatformDelivery: ['iOS'] }),
      sampleAsset({ Build: 'C3', PlatformDelivery: ['macOS-invisible'] }),
    ]);
    const assets = new Font8CatalogParser(catalogPath).assets();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.assetId()).toBe('a1');
  });
});

describe('Macos::Catalog::CatalogManager', () => {
  let dir: string;
  let cachePath: string;

  beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-mgr-'));
    cachePath = path.join(dir, 'macos_catalogs');
    await writeCatalog(cachePath, 6, [sampleAsset()]);
    await writeCatalog(cachePath, 7, [sampleAsset()]);
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('discovers downloaded catalogs', () => {
    const catalogs = CatalogManager.availableCatalogs(cachePath);
    expect(catalogs.some((c) => c.includes('Font6'))).toBe(true);
    expect(catalogs.some((c) => c.includes('Font7'))).toBe(true);
    expect(CatalogManager.latestCatalog(cachePath)!.includes('Font7')).toBe(true);
    expect(CatalogManager.allAssets(cachePath)).toHaveLength(2);
  });

  it('selects parsers by version', () => {
    const catalogs = CatalogManager.availableCatalogs(cachePath);
    const font7 = catalogs.find((c) => c.includes('Font7'))!;
    expect(CatalogManager.parserFor(font7)).toBeInstanceOf(Font7CatalogParser);
    expect(CatalogManager.detectVersion(font7)).toBe(7);
  });

  it('rejects unsupported versions', async () => {
    expect(() => CatalogManager.parserFor('/x/Font9.xml')).toThrow(ArgumentError);
    await expect(
      CatalogManager.downloadCatalog(99, { cachePath: path.join(dir, 'dl') }),
    ).rejects.toThrow(ArgumentError);
  });

  it('downloads catalogs through the injectable fetcher', async () => {
    const dlDir = path.join(dir, 'download-cache');
    const catalogXml = plistXml({ version: 5, postedDate: POSTED, assets: [] });
    const fetched = await CatalogManager.downloadCatalog(5, {
      cachePath: dlDir,
      fetchImpl: (async () =>
        new Response(catalogXml, { status: 200 })) as unknown as typeof fetch,
    });
    expect(fetched).toContain('Font5');
    // second call serves from cache
    const cached = await CatalogManager.downloadCatalog(5, { cachePath: dlDir });
    expect(cached).toBe(fetched);
  });

  it('returns null when the download fails', async () => {
    const result = await CatalogManager.downloadCatalog(4, {
      cachePath: path.join(dir, 'fail-cache'),
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
      error: () => {},
    });
    expect(result).toBeNull();
  });
});

describe('MacosFrameworkMetadata', () => {
  it('reports framework version ranges', () => {
    expect(macosFrameworkMinVersion(3)).toBe('10.12');
    expect(macosFrameworkMaxVersion(3)).toBe('10.12');
    expect(macosFrameworkMinVersion(7)).toBe('12.0');
    expect(macosFrameworkMaxVersion(8)).toBeNull();
  });

  it('checks compatibility across frameworks', () => {
    expect(macosFrameworkCompatibleWith(7, '13.0')).toBe(true);
    expect(macosFrameworkCompatibleWith(7, '11.0')).toBe(false);
    expect(macosFrameworkCompatibleWith(8, '26.0')).toBe(true);
    expect(macosFrameworkCompatibleWith(8, '15.0')).toBe(false);
  });

  it('determines the newest framework for a macOS version', () => {
    expect(macosFrameworkForMacos('10.12')).toBe(3);
    expect(macosFrameworkForMacos('10.15')).toBe(6);
    expect(macosFrameworkForMacos('13.0')).toBe(7);
    expect(macosFrameworkForMacos('26.0')).toBe(8);
  });
});
