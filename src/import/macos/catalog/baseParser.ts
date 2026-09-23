import { readFileSync } from 'node:fs';
import plist from 'plist';
import { CatalogAsset, type CatalogAssetData } from './asset.js';

/** Base parser for macOS font catalogs (Ruby Macos::Catalog::BaseParser).
 * Catalogs are XML plists downloaded from Apple's mesu endpoint. */
export class BaseCatalogParser {
  protected data: Record<string, unknown> | null = null;

  constructor(readonly xmlPath: string) {}

  assets(): CatalogAsset[] {
    const postedDate = this.postedDate();
    const frameworkVersion = this.frameworkVersion();
    return this.parseAssets().map(
      (assetData) =>
        new CatalogAsset(assetData as CatalogAssetData, { postedDate, frameworkVersion }),
    );
  }

  postedDate(): string | null {
    const raw = this.read()['postedDate'];
    if (!raw) return null;
    if (raw instanceof Date) {
      return raw.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed)) {
        this.reportError(`Could not parse postedDate: ${raw}`);
        return null;
      }
      return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    return String(raw);
  }

  /** Extracted from the filename: com_apple_MobileAsset_Font7.xml → 7. */
  catalogVersion(): number {
    return this.versionFromPath();
  }

  frameworkVersion(): number {
    return this.versionFromPath();
  }

  protected parseAssets(): Array<Record<string, unknown>> {
    return (this.read()['Assets'] as Array<Record<string, unknown>>) ?? [];
  }

  protected read(): Record<string, unknown> {
    if (!this.data) {
      this.data = plist.parse(readFileSync(this.xmlPath, 'utf8')) as Record<string, unknown>;
    }
    return this.data!;
  }

  private versionFromPath(): number {
    const match = this.xmlPath.match(/Font(\d+)/);
    if (!match) {
      throw new ArgumentError(`Cannot detect version from: ${this.xmlPath}`);
    }
    return Number.parseInt(match[1]!, 10);
  }

  private reportError(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

export class ArgumentError extends Error {}
