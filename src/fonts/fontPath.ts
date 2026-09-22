import type { FontistContext } from '../context.js';
import { FormulaRepository } from '../formula/formulaRepository.js';

/** Decorated font path renderer (Ruby `FontPath`): fontist-managed fonts are
 * suffixed with the formulas that provide them, e.g.
 * `- /path/Font.ttf (from Formula A or Formula B formula)`. */
export class FontPath {
  constructor(
    private readonly fontPath: string,
    private readonly ctx: FontistContext,
  ) {}

  async toString(): Promise<string> {
    const parts: string[] = ['-', this.fontPath];
    const formulas = await this.formulas();
    if (formulas.length > 0) {
      parts.push(`(from ${formulas.join(' or ')} formula)`);
    }
    return parts.join(' ');
  }

  private async formulas(): Promise<string[]> {
    if (!this.isFontistFont()) return [];
    const { FormulaFilenameIndex } = await import('../index/formula/formulaFontIndex.js');
    const filenameIndex = new FormulaFilenameIndex(this.ctx, new FormulaRepository(this.ctx));
    const formulas = await filenameIndex.loadFormulasByFile(path6(this.fontPath));
    return formulas.map((formula) => formula.name ?? formula.key());
  }

  /** Fontist-managed check: normalized separator comparison, case-sensitive
   * on POSIX and case-insensitive on Windows (Ruby parity). */
  private isFontistFont(): boolean {
    const normalizedPath = this.fontPath.replace(/\\/g, '/');
    const normalizedFontsPath = `${this.ctx.paths.fontsPath()}`.replace(/\\/g, '/');
    if (this.ctx.platform === 'windows') {
      return normalizedPath.toLowerCase().startsWith(normalizedFontsPath.toLowerCase());
    }
    return normalizedPath.startsWith(normalizedFontsPath);
  }
}

function path6(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}
