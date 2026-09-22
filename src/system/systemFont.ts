import type { FontistContext } from '../context.js';
import type { FormatMatcher } from '../formula/formatMatcher.js';
import type { SystemIndexFont } from '../index/installed/systemIndexFont.js';
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

interface IndexSet {
  fontist: FontistIndex;
  user: UserIndex;
  system: SystemIndex;
}

/** System-wide font discovery over the three installed-font indexes.
 * Index instances and find results are memoized per instance (Ruby's
 * Singleton indexes + `find_styles` cache). */
export class SystemFont {
  private readonly ctx: FontistContext;
  private indexSet: IndexSet | null = null;
  private findStylesCache: Map<string, FoundStyle[]> | null = null;
  private findStylesCacheEnabled = false;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
  }

  /** Paths of fonts with the given family name across all scopes. */
  async find(name: string): Promise<string[] | null> {
    const styles = await this.findStyles(name);
    if (styles === null) return null;
    const paths = Array.from(new Set(styles.map((entry) => entry.path)));
    return paths.length > 0 ? paths : null;
  }

  /** Styles matching name/style across all scopes, deduped by path.
   * Results are memoized per (name, style) like Ruby's find_styles cache. */
  async findStyles(
    name: string,
    style: string | null = null,
    formatMatcher: FormatMatcher | null = null,
  ): Promise<FoundStyle[] | null> {
    const cacheKey = `${name}:${style ?? ''}:${formatMatcher ? 'fmt' : ''}`;
    if (this.findStylesCacheEnabled) {
      const cached = this.findStylesCache?.get(cacheKey);
      if (cached) return cached;
    }
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
    const results = Array.from(byPath.values());
    if (this.findStylesCacheEnabled) {
      this.findStylesCache?.set(cacheKey, results);
    }
    return results.length > 0 ? results : null;
  }

  /** All font files visible to the system/user scopes. */
  async fontPaths(): Promise<string[]> {
    const dirs = [
      ...(await systemFontPaths(this.ctx)),
      defaultUserFontPath(this.ctx.platform, this.ctx.env),
    ];
    return scanFontPaths(dirs);
  }

  enableFindStylesCache(): this {
    this.findStylesCache = new Map();
    this.findStylesCacheEnabled = true;
    return this;
  }

  resetFindStylesCache(): void {
    this.findStylesCache = new Map();
  }

  disableFindStylesCache(): void {
    this.findStylesCache = null;
    this.findStylesCacheEnabled = false;
  }

  /** Memoized indexes are reused only for the plain (matcher-less) case;
   * a matcher changes filtering, matching Ruby's fixed-per-process singletons. */
  private async findEntries(
    name: string,
    style: string | null,
    formatMatcher: FormatMatcher | null,
  ): Promise<SystemIndexFont[]> {
    const set =
      formatMatcher === null
        ? (this.indexSet ??= this.buildIndexes(null))
        : this.buildIndexes(formatMatcher);
    const results: SystemIndexFont[] = [];
    for (const index of [set.fontist, set.user, set.system]) {
      results.push(...((await index.find(name, style)) ?? []));
    }
    return results;
  }

  private buildIndexes(formatMatcher: FormatMatcher | null): IndexSet {
    const userDir = defaultUserFontPath(this.ctx.platform, this.ctx.env);
    return {
      fontist: new FontistIndex(this.ctx, formatMatcher),
      user: new UserIndex(this.ctx, userDir, formatMatcher),
      system: new SystemIndex(this.ctx, formatMatcher),
    };
  }
}
