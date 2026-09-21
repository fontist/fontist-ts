/** Encapsulates format requirements (format, variable axes, transcode hints)
 * passed through the whole pipeline: CLI → Font → FormulaPicker → installer. */
export class FormatSpec {
  readonly format: string | null;
  readonly variableAxes: string[];
  readonly preferVariable: boolean;
  readonly preferFormat: string | null;
  readonly transcodePath: string | null;
  readonly keepOriginal: boolean;
  readonly collectionIndex: number | null;

  constructor(options: Partial<FormatSpecOptions> = {}) {
    this.format = options.format ?? null;
    this.variableAxes = parseVariableAxes(options.variableAxes);
    this.preferVariable = options.preferVariable ?? false;
    this.preferFormat = options.preferFormat ?? null;
    this.transcodePath = options.transcodePath ?? null;
    this.keepOriginal = options.keepOriginal ?? true;
    this.collectionIndex = options.collectionIndex ?? null;
  }

  static fromOptions(options: Partial<FormatSpecOptions> = {}): FormatSpec {
    return new FormatSpec({
      ...options,
      variableAxes: parseVariableAxes(options.variableAxes),
    });
  }

  hasConstraints(): boolean {
    return Boolean(this.format || this.variableAxes.length > 0 || this.preferVariable || this.preferFormat);
  }

  variableRequested(): boolean {
    return this.variableAxes.length > 0 || this.preferVariable;
  }

  axes(): string[] {
    return this.variableAxes;
  }

  needsTranscode(availableFormats: string[]): boolean {
    return this.format !== null && !availableFormats.includes(this.format);
  }

  hasSpecificCollectionIndex(): boolean {
    return this.collectionIndex !== null;
  }
}

export interface FormatSpecOptions {
  format: string | null | undefined;
  variableAxes: string | string[] | null | undefined;
  preferVariable: boolean | null | undefined;
  preferFormat: string | null | undefined;
  transcodePath: string | null | undefined;
  keepOriginal: boolean | null | undefined;
  collectionIndex: number | null | undefined;
}

export function parseVariableAxes(value: string | string[] | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(',')
    .map((axis) => axis.trim())
    .filter((axis) => axis.length > 0);
}
