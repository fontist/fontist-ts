import type { FontStyle, Resource } from './models.js';
import { FormatSpec } from './formatSpec.js';

export const DESKTOP_FORMATS: readonly string[] = ['ttf', 'otf', 'ttc', 'otc', 'dfont'];
export const WEB_FORMATS: readonly string[] = ['woff', 'woff2'];
export const ALL_FORMATS: readonly string[] = [...DESKTOP_FORMATS, ...WEB_FORMATS];

export type InstallationStrategy =
  | { strategy: 'install'; format: string }
  | { strategy: 'convert'; from: string; to: string }
  | { strategy: 'unavailable'; requested: string; available: string[] };

/** Centralized format-matching service over resources, styles, and indexed
 * fonts; also decides the installation strategy (install vs convert). */
export class FormatMatcher {
  private readonly spec: FormatSpec;

  constructor(spec: FormatSpec | null | undefined) {
    this.spec = spec ?? new FormatSpec();
  }

  hasConstraints(): boolean {
    return this.spec.hasConstraints();
  }

  matchesResource(resource: Resource): boolean {
    if (!this.spec.hasConstraints()) return true;
    if (this.spec.format && resource.format && resource.format !== this.spec.format) {
      return false;
    }
    if (this.spec.variableRequested()) {
      if (!resource.isVariableFont()) return false;
      if (this.spec.axes().length > 0 && !this.axesMatch(resource.variableAxes)) return false;
    }
    return true;
  }

  matchesStyle(style: FontStyle): boolean {
    if (!this.spec.hasConstraints()) return true;
    if (
      this.spec.format &&
      style.formats.length > 0 &&
      !style.formats.includes(this.spec.format)
    ) {
      return false;
    }
    if (this.spec.variableRequested()) {
      if (!style.isVariableFont()) return false;
      if (this.spec.axes().length > 0 && !this.axesMatch(style.variableAxes)) return false;
    }
    return true;
  }

  matchesIndexedFont(font: {
    format: string | null;
    isVariable: boolean;
    variableAxes: string[];
  }): boolean {
    if (!this.spec.hasConstraints()) return true;
    if (this.spec.format && font.format !== this.spec.format) return false;
    if (this.spec.variableRequested()) {
      if (!font.isVariable) return false;
      if (this.spec.axes().length > 0 && !this.axesMatch(font.variableAxes)) return false;
    }
    return true;
  }

  filterResources(resources: Resource[]): Resource[] {
    return resources.filter((r) => this.matchesResource(r));
  }

  filterStyles(styles: FontStyle[]): FontStyle[] {
    return styles.filter((s) => this.matchesStyle(s));
  }

  /** Preference order: exact format → preferred format → variable → first. */
  selectPreferredResource(resources: Resource[]): Resource | null {
    if (resources.length === 0) return null;
    if (!this.spec.hasConstraints()) return resources[0]!;
    const exact = this.spec.format
      ? resources.find((r) => r.format === this.spec.format)
      : undefined;
    if (exact) return exact;
    const preferred = this.spec.preferFormat
      ? resources.find((r) => r.format === this.spec.preferFormat)
      : undefined;
    if (preferred) return preferred;
    if (this.spec.preferVariable) {
      const variable = resources.find((r) => r.isVariableFont());
      if (variable) return variable;
    }
    return resources[0]!;
  }

  installationStrategy(availableFormats: (string | null)[]): InstallationStrategy {
    const available = availableFormats.filter((f): f is string => f !== null);
    const requested = this.spec.format;
    if (!requested) {
      return { strategy: 'install', format: available[0] ?? DESKTOP_FORMATS[0]! };
    }
    if (available.includes(requested)) {
      return { strategy: 'install', format: requested };
    }
    const convertible = available.find((f) => canConvert(f, requested));
    if (convertible) {
      return { strategy: 'convert', from: convertible, to: requested };
    }
    return { strategy: 'unavailable', requested, available };
  }

  private axesMatch(availableAxes: string[]): boolean {
    if (this.spec.axes().length === 0) return true;
    return this.spec.axes().every((axis) => availableAxes.includes(axis));
  }
}

/** Desktop→web is the only supported conversion direction. */
export function canConvert(fromFormat: string | null, toFormat: string | null): boolean {
  if (!fromFormat || !toFormat) return false;
  return DESKTOP_FORMATS.includes(fromFormat) && WEB_FORMATS.includes(toFormat);
}
