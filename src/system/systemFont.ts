import type { FontistContext } from '../context.js';
import type { FormatMatcher } from '../formula/formatMatcher.js';
import { FontistIndex, SystemIndex, UserIndex } from '../index/installed/collectionIndexes.js';
import { scanFontPaths } from './pathScanning.js';
import { systemFontPaths } from './systemFontsData.js';
import { defaultUserFontPath } from './fontDirs.js';

export interface FoundStyle {
  path: string;
  fullName: string | null;
  familyName: string | null;
  subfamily: string | null;
}

/** System-wide font discovery over the three installed-font indexes. */
export class SystemFont {
  private readonly ctx: FontistContext;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
  }

  /** Paths of fonts with the given family/full name across all scopes. */
  async find(name: string): Promise<string[] | null> {
    const entries = await this.findEntries(name, null, null);
    const paths = Array.from(new Set(entries.map((entry) => entry.path)));
    return paths.length > 0 ? paths : null;
  }

  /** Styles matching name/style across all scopes, deduped by path. */
  async findStyles(
    name: string,
    style: string | null = null,
    formatMatcher: FormatMatcher | null = null,
  ): Promise<FoundStyle[]> {
    const entries = await this.findEntries(name, style, formatMatcher);
    const byPath = new Map<string, FoundStyle>();
    for (const entry of entries) {
      if (!byPath.has(entry.path)) {
        byPath.set(entry.path, {
          path: entry.path,
          fullName: entry.fullName,
          familyName: entry.familyName,
          subfamily: entry.subfamily,
        });
      }
    }
    return Array.from(byPath.values());
  }

  /** All font files visible to the system/user scopes. */
  async fontPaths(): Promise<string[]> {
    const dirs = [
      ...(await systemFontPaths(this.ctx)),
      defaultUserFontPath(this.ctx.platform, this.ctx.env),
    ];
    return scanFontPaths(dirs);
  }

  private async findEntries(
    name: string,
    style: string | null,
    formatMatcher: FormatMatcher | null,
  ) {
    const indexes = [
      new FontistIndex(this.ctx, formatMatcher),
      new UserIndex(this.ctx, defaultUserFontPath(this.ctx.platform, this.ctx.env), formatMatcher),
      new SystemIndex(this.ctx, formatMatcher),
    ];
    const results = [];
    for (const index of indexes) {
      results.push(...(await index.find(name, style)));
    }
    return results;
  }
}
