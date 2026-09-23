import { FormatMatcher } from './formatMatcher.js';
import type { FormatSpec } from './formatSpec.js';
import type { Formula } from './formula.js';
import type { Resource } from './models.js';

export interface FontMatchData {
  name: string | null;
  resource?: string | null;
  resources?: string[];
  axes?: string[];
  format?: string | null;
  category?: string;
}

/** Result object for capability searches (Ruby FontMatch, `to_h` compacts). */
export class FontMatch {
  constructor(private readonly data: FontMatchData) {}

  toObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.data)) {
      if (value !== null && value !== undefined) result[key] = value;
    }
    return result;
  }
}

/** Finds fonts by their capabilities: variable axes, variable support,
 * and (name-heuristic) categories (Ruby font_finder.rb). */
export class FontFinder {
  private readonly formatSpec: FormatSpec | null;
  private readonly category: string | null;

  constructor(
    private readonly formulas: Formula[],
    options: { formatSpec?: FormatSpec | null; category?: string | null } = {},
  ) {
    this.formatSpec = options.formatSpec ?? null;
    this.category = options.category ?? null;
  }

  /** Fonts (v5 resources) supporting ALL the requested axes. */
  byAxes(axes: string[]): FontMatch[] {
    return this.matchingFormulas()
      .filter((formula) => formula.isV5())
      .flatMap((formula) =>
        this.formatFiltered(formula)
          .filter((resource) => resource.isVariableFont() && axesSupported(resource, axes))
          .map((resource) => this.buildFontMatch(formula, resource)),
      );
  }

  /** All variable fonts. */
  variableFonts(): FontMatch[] {
    return this.matchingFormulas()
      .filter((formula) => formula.isV5())
      .flatMap((formula) =>
        this.formatFiltered(formula)
          .filter((resource) => resource.isVariableFont())
          .map((resource) => this.buildFontMatch(formula, resource)),
      );
  }

  /** Fonts by category (name heuristic, mirroring Ruby). */
  byCategory(category: string): FontMatch[] {
    return this.matchingFormulas()
      .filter((formula) => detectCategoryFromName(formula.name) === category)
      .map((formula) => {
        const resourceNames = formula.resources
          .map((resource) => resource.name)
          .filter((name): name is string => name !== null);
        return new FontMatch({ name: formula.name, resources: resourceNames, category });
      });
  }

  private matchingFormulas(): Formula[] {
    if (this.category === null) return this.formulas;
    return this.formulas.filter((formula) => detectCategoryFromName(formula.name) === this.category);
  }

  private formatFiltered(formula: Formula): Resource[] {
    const resources = formula.resources;
    if (this.formatSpec === null || !this.formatSpec.hasConstraints()) return resources;
    return new FormatMatcher(this.formatSpec).filterResources(resources);
  }

  private buildFontMatch(formula: Formula, resource: Resource): FontMatch {
    return new FontMatch({
      name: formula.name,
      resource: resource.name,
      axes: resource.variableAxes,
      format: resource.format,
      category: detectCategoryFromName(formula.name),
    });
  }
}

function axesSupported(resource: Resource, requiredAxes: string[]): boolean {
  return requiredAxes.every((axis) => resource.variableAxes.includes(axis));
}

/** Ruby's documented name heuristics for categories. */
export function detectCategoryFromName(name: string | null): string {
  if (name === null) return 'sans-serif';
  if (/mono/i.test(name)) return 'monospace';
  if (/sans[-\s]?serif/i.test(name)) return 'sans-serif';
  if (/serif/i.test(name)) return 'serif';
  return 'sans-serif';
}
