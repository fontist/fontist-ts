import { BaseCatalogParser, ArgumentError } from './baseParser.js';
import type { CatalogAsset } from './asset.js';
import type { CatalogAssetData } from './asset.js';

/** Font7 (Monterey..Sequoia): all assets are macOS-compatible (Ruby
 * Font7Parser). */
export class Font7CatalogParser extends BaseCatalogParser {}

/** Font8 (Tahoe+): filters assets by asset-level PlatformDelivery (Ruby
 * Font8Parser). */
export class Font8CatalogParser extends BaseCatalogParser {
  protected override parseAssets(): Array<Record<string, unknown>> {
    return super
      .parseAssets()
      .filter((asset) => this.macosCompatible(asset as CatalogAssetData));
  }

  private macosCompatible(asset: CatalogAssetData): boolean {
    const platformDelivery = asset['PlatformDelivery'];
    if (!platformDelivery || platformDelivery.length === 0) return true;
    return platformDelivery.some(
      (platform) => platform.includes('macOS') && platform !== 'macOS-invisible',
    );
  }
}

/** Font3–Font6 behave like the base parser. */
export class Font3CatalogParser extends BaseCatalogParser {}
export class Font4CatalogParser extends BaseCatalogParser {}
export class Font5CatalogParser extends BaseCatalogParser {}
export class Font6CatalogParser extends BaseCatalogParser {}

export type { CatalogAsset };

const PARSERS: Record<number, new (path: string) => BaseCatalogParser> = {
  3: Font3CatalogParser,
  4: Font4CatalogParser,
  5: Font5CatalogParser,
  6: Font6CatalogParser,
  7: Font7CatalogParser,
  8: Font8CatalogParser,
};

/** Manages macOS font catalogs across versions: discovery, download, and
 * parser selection (Ruby Macos::Catalog::CatalogManager). */
export class CatalogManager {
  static readonly CATALOG_URLS: ReadonlyMap<number, string> = new Map([
    [3, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font3/com_apple_MobileAsset_Font3.xml'],
    [4, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font4/com_apple_MobileAsset_Font4.xml'],
    [5, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font5/com_apple_MobileAsset_Font5.xml'],
    [6, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font6/com_apple_MobileAsset_Font6.xml'],
    [7, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font7/com_apple_MobileAsset_Font7.xml'],
    [8, 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_Font8/com_apple_MobileAsset_Font8.xml'],
  ]);

  /** Downloaded catalogs from the local cache directory (sorted). */
  static availableCatalogs(catalogCachePath: string): string[] {
    return listCatalogXmls(catalogCachePath).sort();
  }

  static catalogCachePath(versionsPath: string): string {
    return joinPath(versionsPath, 'macos_catalogs');
  }

  /** Downloads the catalog for a version unless already cached; returns the
   * catalog path or null on network failure. */
  static async downloadCatalog(
    version: number,
    options: {
      cachePath: string;
      fetchImpl?: typeof fetch;
      say?: (message: string) => void;
      error?: (message: string) => void;
    },
  ): Promise<string | null> {
    const cached = listCatalogXmls(joinPath(options.cachePath, `com_apple_MobileAsset_Font${version}`))[0];
    if (cached) return cached;

    const url = CatalogManager.CATALOG_URLS.get(version);
    if (!url) {
      throw new ArgumentError(
        `Unsupported Font catalog version: ${version}. Supported versions: 3, 4, 5, 6, 7, 8`,
      );
    }

    const versionDir = joinPath(options.cachePath, `com_apple_MobileAsset_Font${version}`);
    mkdirp(versionDir);
    const catalogFile = joinPath(versionDir, `${basenameOf(url)}.xml`);

    options.say?.(`Downloading Font${version} catalog from ${url}...`);
    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeText(catalogFile, await response.text());
      return catalogFile;
    } catch (err) {
      options.error?.(`Failed to download Font${version} catalog: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  static detectVersion(catalogPath: string): number {
    const match = catalogPath.match(/Font(\d+)/);
    if (!match) {
      throw new ArgumentError(`Cannot detect version from: ${catalogPath}`);
    }
    return Number.parseInt(match[1]!, 10);
  }

  static parserFor(catalogPath: string): BaseCatalogParser {
    const version = CatalogManager.detectVersion(catalogPath);
    const parserClass = PARSERS[version];
    if (!parserClass) {
      throw new ArgumentError(
        `Unsupported Font catalog version: ${version}. Supported versions: 3, 4, 5, 6, 7, 8`,
      );
    }
    return new parserClass(catalogPath);
  }

  static allAssets(catalogCachePath: string): CatalogAsset[] {
    return CatalogManager.availableCatalogs(catalogCachePath).flatMap((catalogPath) =>
      CatalogManager.parserFor(catalogPath).assets(),
    );
  }

  static latestCatalog(catalogCachePath: string): string | null {
    const catalogs = CatalogManager.availableCatalogs(catalogCachePath);
    return catalogs[catalogs.length - 1] ?? null;
  }

  static catalogForVersion(
    version: number,
    catalogCachePath: string,
    options: Parameters<typeof CatalogManager.downloadCatalog>[1],
  ): Promise<string | null> {
    const existing = CatalogManager.availableCatalogs(catalogCachePath).find((path) =>
      path.includes(`Font${version}`),
    );
    return Promise.resolve(existing ?? CatalogManager.downloadCatalog(version, options));
  }
}

import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

function listCatalogXmls(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.xml')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function joinPath(...parts: string[]): string {
  return path.join(...parts);
}

function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeText(file: string, content: string): void {
  writeFileSync(file, content);
}

function basenameOf(url: string): string {
  return url.split('/').pop() ?? url;
}
