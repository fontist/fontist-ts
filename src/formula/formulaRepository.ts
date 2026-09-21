import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { FormulaNotFoundError } from '../errors/errors.js';
import { mapWithConcurrency } from '../util/concurrency.js';
import { Formula, keyFromPath, titleize } from './formula.js';

const FORMULA_PARSE_CONCURRENCY = 8;

export interface FormulaRepositoryOptions {
  /** Overrides the Formulas root (tests, private repos). */
  root?: string;
}

/** Lookup service over the installed formulas directory. Parsed formulas are
 * memoized per instance (invalidate after repo updates) and parsed with
 * bounded concurrency. */
export class FormulaRepository {
  private readonly ctx: FontistContext;
  private readonly rootOverride: string | undefined;
  private cache: Promise<Formula[]> | null = null;
  private keysCache: Promise<string[]> | null = null;

  constructor(ctx: FontistContext, options: FormulaRepositoryOptions = {}) {
    this.ctx = ctx;
    this.rootOverride = options.root;
  }

  /** The Formulas directory (lazily ensuring the repo is cloned happens in
   * `ensureRepo`, which needs the repo layer — kept out of the model layer). */
  root(): string {
    return this.rootOverride ?? this.ctx.paths.formulasPath();
  }

  /** Drops the memoized formula list (call after repo updates). */
  invalidate(): void {
    this.cache = null;
    this.keysCache = null;
  }

  async all(): Promise<Formula[]> {
    if (!this.cache) {
      this.cache = this.parseAll();
    }
    return this.cache;
  }

  async allKeys(): Promise<string[]> {
    if (!this.keysCache) {
      this.keysCache = this.formulaFiles(this.root()).then((files) =>
        files.map((file) => keyFromPath(file, this.root())),
      );
    }
    return this.keysCache;
  }

  private async parseAll(): Promise<Formula[]> {
    const files = await this.formulaFiles(this.root());
    const formulas = await mapWithConcurrency(files, FORMULA_PARSE_CONCURRENCY, (file) => this.fromFile(file));
    return formulas.filter((f): f is Formula => f !== null);
  }

  async fromFile(formulaPath: string): Promise<Formula | null> {
    try {
      const text = await fsp.readFile(formulaPath, 'utf8');
      const formula = Formula.fromYaml(text) as Formula;
      formula.path = formulaPath;
      formula.keyValue = keyFromPath(formulaPath, this.root());
      if (formula.name === null) {
        formula.name = titleize(formula.keyValue);
      }
      return formula;
    } catch (err) {
      this.ctx.ui.error(`WARN: Could not load formula ${formulaPath}: ${String(err)}`);
      return null;
    }
  }

  async findByKey(key: string): Promise<Formula | null> {
    const formulaPath = path.join(this.root(), `${key}.yml`);
    if (!(await pathExists(formulaPath))) return null;
    return this.fromFile(formulaPath);
  }

  async findByName(name: string): Promise<Formula | null> {
    return this.findByKey(nameToKey(name));
  }

  async findByKeyOrName(keyOrName: string): Promise<Formula | null> {
    const byKey = await this.findByKey(keyOrName);
    if (byKey) return byKey;
    return this.findByKey(nameToKey(keyOrName));
  }

  /** All formulas declaring a font with the given name (via the font index). */
  async findFormulasForFont(fontName: string): Promise<Formula[]> {
    const { FormulaIndexRegistry } = await import('../index/formula/formulaFontIndex.js');
    const registry = new FormulaIndexRegistry(this.ctx, this);
    return registry.fontIndex().loadFormulas(fontName);
  }

  /** FormulaNotFound check helper mirroring Ruby's raising variant. */
  async fromFileOrRaise(formulaPath: string): Promise<Formula> {
    const formula = await this.fromFile(formulaPath);
    if (formula === null) {
      throw new FormulaNotFoundError(formulaPath);
    }
    return formula;
  }

  private async formulaFiles(root: string): Promise<string[]> {
    const results: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.yml')) {
          results.push(full);
        }
      }
    }
    return results.sort();
  }
}

export function nameToKey(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
