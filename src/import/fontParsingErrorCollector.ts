export interface FontParsingError {
  path: string;
  message: string;
  backtrace?: string[];
}

/** Collects font parsing errors during import for later reporting
 * (Ruby FontParsingErrorCollector). */
export class FontParsingErrorCollector {
  private readonly errorList: FontParsingError[] = [];

  add(filePath: string, errorMessage: string, backtrace?: string[]): void {
    this.errorList.push({ path: filePath, message: errorMessage, backtrace });
  }

  get errors(): FontParsingError[] {
    return this.errorList;
  }

  any(): boolean {
    return this.errorList.length > 0;
  }

  get count(): number {
    return this.errorList.length;
  }

  /** Errors grouped by basename for cleaner display. */
  groupedErrors(): Map<string, FontParsingError[]> {
    const groups = new Map<string, FontParsingError[]>();
    for (const error of this.errorList) {
      const base = error.path.split('/').pop() ?? error.path;
      const list = groups.get(base) ?? [];
      list.push(error);
      groups.set(base, list);
    }
    return groups;
  }
}
