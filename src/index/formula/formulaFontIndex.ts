import * as path from 'node:path';
import type { FontistContext } from '../../context.js';
import type { Formula } from '../../formula/formula.js';
import type { FontStyle } from '../../formula/models.js';
import type { FormulaRepository } from '../../formula/formulaRepository.js';
import { loadIndexEntries, saveIndexEntries, type IndexEntries } from './indexFile.js';

/** Base for indexes mapping a normalized font key to formula paths
 * (Ruby IndexMixin). Subclasses choose the key for each style. */
export abstract class FormulaFontIndex {
  protected entries: IndexEntries | null = null;

  constructor(
    protected readonly ctx: FontistContext,
    protected readonly repository: FormulaRepository,
  ) {}

  protected abstract indexPath(): string;
  protected abstract indexKeyForStyle(style: FontStyle): string | null;
  protected normalizeKey(key: string): string {
    return key.toLowerCase();
  }

  /** Loads the index from disk, rebuilding it when missing. */
  async load(): Promise<void> {
    if (this.entries) return;
    const loaded = await loadIndexEntries(this.indexPath());
    if (loaded === null) {
      await this.rebuild();
      return;
    }
    this.entries = loaded;
  }

  async rebuild(): Promise<void> {
    const formulas = await this.repository.all();
    await this.rebuildWithFormulas(formulas);
  }

  async rebuildWithFormulas(formulas: Formula[]): Promise<void> {
    const entries: IndexEntries = new Map();
    for (const formula of formulas) {
      const formulaPath = this.relativeFormulaPath(formula);
      for (const style of formula.allStyles()) {
        const key = this.indexKeyForStyle(style);
        if (!key) continue;
        const normalized = this.normalizeKey(key);
        const list = entries.get(normalized);
        if (list) {
          if (!list.includes(formulaPath)) list.push(formulaPath);
        } else {
          entries.set(normalized, [formulaPath]);
        }
      }
    }
    this.entries = entries;
    await saveIndexEntries(this.indexPath(), entries);
  }

  /** Formulas whose indexed key matches, preserving multi-path entries. */
  async loadFormulas(key: string): Promise<Formula[]> {
    await this.load();
    const normalized = this.normalizeKey(key);
    const paths = this.entries?.get(normalized) ?? [];
    const formulas = await Promise.all(
      paths.map(async (relative) => this.repository.findByKey(relative)),
    );
    return formulas.filter((f): f is Formula => f !== null);
  }

  async reset(): Promise<void> {
    this.entries = null;
    const { removeFile } = await import('../../util/fsx.js');
    await removeFile(this.indexPath());
  }

  protected relativeFormulaPath(formula: Formula): string {
    if (formula.path === null) return formula.key();
    const root = this.repository.root();
    const normalized = formula.path.replace(/\\/g, '/');
    const normalizedRoot = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
    return normalized.startsWith(normalizedRoot)
      ? normalized.slice(normalizedRoot.length).replace(/\.yml$/, '')
      : path.relative(root, formula.path).replace(/\.yml$/, '');
  }
}

/** Index on the style's default family (`default_family_name || family_name`). */
export class DefaultFamilyFontIndex extends FormulaFontIndex {
  protected indexPath(): string {
    return this.ctx.paths.formulaDefaultFamilyIndexPath();
  }

  protected indexKeyForStyle(style: FontStyle): string | null {
    return style.defaultFamilyName ?? style.familyName;
  }
}

/** Index on the style's preferred family (`preferred_family_name || family_name`). */
export class PreferredFamilyFontIndex extends FormulaFontIndex {
  protected indexPath(): string {
    return this.ctx.paths.formulaPreferredFamilyIndexPath();
  }

  protected indexKeyForStyle(style: FontStyle): string | null {
    return style.preferredFamilyName ?? style.familyName;
  }
}

/** Index on the installed font filename (`style.font`), case-sensitive. */
export class FormulaFilenameIndex extends FormulaFontIndex {
  protected indexPath(): string {
    return this.ctx.paths.formulaFilenameIndexPath();
  }

  protected override normalizeKey(key: string): string {
    return key;
  }

  protected indexKeyForStyle(style: FontStyle): string | null {
    return style.font;
  }

  /** Lookups by filename are exact-match (no case folding). */
  async loadFormulasByFile(fileName: string): Promise<Formula[]> {
    return this.loadFormulas(fileName);
  }
}

/** Chooses the family index flavor per config (`preferred_family`). */
export class FormulaIndexRegistry {
  constructor(
    private readonly ctx: FontistContext,
    private readonly repository: FormulaRepository,
  ) {}

  fontIndex(): FormulaFontIndex {
    return this.ctx.config.get('preferred_family')
      ? new PreferredFamilyFontIndex(this.ctx, this.repository)
      : new DefaultFamilyFontIndex(this.ctx, this.repository);
  }

  filenameIndex(): FormulaFilenameIndex {
    return new FormulaFilenameIndex(this.ctx, this.repository);
  }

  /** Rebuilds all formula indexes (after repo update). */
  async rebuildAll(): Promise<void> {
    const formulas = await this.repository.all();
    await Promise.all([
      new DefaultFamilyFontIndex(this.ctx, this.repository).rebuildWithFormulas(formulas),
      new PreferredFamilyFontIndex(this.ctx, this.repository).rebuildWithFormulas(formulas),
      this.filenameIndex().rebuildWithFormulas(formulas),
    ]);
  }
}
