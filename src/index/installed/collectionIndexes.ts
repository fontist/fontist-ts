import type { FontistContext } from '../../context.js';
import type { FormatMatcher } from '../../formula/formatMatcher.js';
import { scanFontPaths } from '../../system/pathScanning.js';
import { systemFontPaths, systemTemplateBaseDirs } from '../../system/systemFontsData.js';
import { BaseFontCollectionIndex } from './baseFontCollectionIndex.js';

/** Fonts installed under the Fontist-managed directory (`~/.fontist/fonts`). */
export class FontistIndex extends BaseFontCollectionIndex {
  protected indexPath(): string {
    return this.ctx.paths.fontistIndexPath();
  }

  protected async fontPaths(): Promise<string[]> {
    return scanFontPaths([this.ctx.paths.fontsPath()]);
  }

  protected async monitoredDirectories(): Promise<string[]> {
    return [this.ctx.paths.fontsPath()];
  }
}

/** Fonts installed in the platform user font directory. */
export class UserIndex extends BaseFontCollectionIndex {
  constructor(
    ctx: FontistContext,
    private readonly userFontsPath: string,
    formatMatcher: FormatMatcher | null = null,
  ) {
    super(ctx, formatMatcher);
  }

  protected indexPath(): string {
    return this.ctx.paths.userIndexPath();
  }

  protected async fontPaths(): Promise<string[]> {
    return scanFontPaths([this.userFontsPath]);
  }

  protected async monitoredDirectories(): Promise<string[]> {
    return [this.userFontsPath];
  }
}

/** Fonts installed in system font directories. */
export class SystemIndex extends BaseFontCollectionIndex {
  protected indexPath(): string {
    return this.ctx.paths.systemIndexPath();
  }

  protected async fontPaths(): Promise<string[]> {
    return scanFontPaths(await systemFontPaths(this.ctx));
  }

  protected async monitoredDirectories(): Promise<string[]> {
    return systemTemplateBaseDirs(this.ctx);
  }
}
