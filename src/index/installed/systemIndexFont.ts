import * as yaml from 'yaml';
import type { FormatMatcher } from '../../formula/formatMatcher.js';
import { FontIndexCorrupted } from '../../errors/errors.js';
import { equalsIgnoreCase } from '../../util/compare.js';
import { atomicWriteFile } from '../../util/fsx.js';
import { promises as fsp } from 'node:fs';

export interface SystemIndexFontData {
  path: string;
  full_name: string | null;
  family_name: string | null;
  type: string | null;
  preferred_family_name: string | null;
  preferred_subfamily_name: string | null;
  file_size: number;
  file_mtime: number;
  format: string | null;
  variable_font: boolean;
  variable_axes: string[];
}

/** One indexed font entry, persisted as a YAML mapping. */
export class SystemIndexFont {
  constructor(readonly data: SystemIndexFontData) {}

  get path(): string {
    return this.data.path;
  }
  get fullName(): string | null {
    return this.data.full_name;
  }
  get familyName(): string | null {
    return this.data.family_name;
  }
  get subfamily(): string | null {
    return this.data.type;
  }
  get preferredFamilyName(): string | null {
    return this.data.preferred_family_name;
  }
  get format(): string | null {
    return this.data.format;
  }
  get isVariable(): boolean {
    return this.data.variable_font;
  }
  get variableAxes(): string[] {
    return this.data.variable_axes;
  }

  matches(name: string, style: string | null): boolean {
    const familyMatch = equalsIgnoreCase(this.familyName, name);
    const fullMatch = equalsIgnoreCase(this.fullName, name);
    if (!familyMatch && !fullMatch) return false;
    if (style === null) return true;
    if (equalsIgnoreCase(this.subfamily, style)) return true;
    return fullMatch && this.fullName !== null && fullNameMatches(this.fullName, style);
  }

  matchesFormat(matcher: FormatMatcher): boolean {
    return matcher.matchesIndexedFont({
      format: this.format,
      isVariable: this.isVariable,
      variableAxes: this.variableAxes,
    });
  }
}

function fullNameMatches(fullName: string, style: string): boolean {
  return fullName.toLowerCase().includes(style.toLowerCase());
}

interface CollectionFileData {
  last_scan_time: number;
  directory_mtimes: string[];
  fonts: SystemIndexFontData[];
}

const SCAN_FRESHNESS_MS = 30 * 60 * 1000;

/** The persisted font collection backing an installed-font index: pure data
 * plus queries; scanning/parsing lives in the index services. */
export class SystemIndexFontCollection {
  private constructor(
    private fonts: SystemIndexFont[],
    private lastScanTime: number,
    private directoryMtimes: string[],
  ) {}

  static empty(): SystemIndexFontCollection {
    return new SystemIndexFontCollection([], 0, []);
  }

  static fromData(data: CollectionFileData | null): SystemIndexFontCollection {
    if (!data || !Array.isArray(data.fonts)) return SystemIndexFontCollection.empty();
    return new SystemIndexFontCollection(
      data.fonts.map((font) => new SystemIndexFont(font)),
      data.last_scan_time ?? 0,
      data.directory_mtimes ?? [],
    );
  }

  replaceAll(
    fonts: SystemIndexFont[],
    scanTime: number,
    directoryMtimes: string[],
  ): void {
    this.fonts = fonts;
    this.lastScanTime = scanTime;
    this.directoryMtimes = directoryMtimes;
  }

  all(): SystemIndexFont[] {
    return this.fonts;
  }

  find(name: string, style: string | null, matcher: FormatMatcher | null): SystemIndexFont[] {
    return this.fonts.filter(
      (font) => font.matches(name, style) && (matcher === null || font.matchesFormat(matcher)),
    );
  }

  /** True when the previous scan is fresh and directory mtimes are unchanged. */
  async isIndexUnchanged(directories: string[]): Promise<boolean> {
    if (this.lastScanTime === 0 || Date.now() - this.lastScanTime > SCAN_FRESHNESS_MS) {
      return false;
    }
    const currentMtimes = await collectDirectoryMtimes(directories);
    return (
      currentMtimes.length === this.directoryMtimes.length &&
      currentMtimes.every((value, index) => value === this.directoryMtimes[index])
    );
  }

  addParsed(font: SystemIndexFont): void {
    this.fonts.push(font);
    this.lastScanTime = Date.now();
  }

  removeByPath(fontPath: string): boolean {
    const index = this.fonts.findIndex((font) => font.path === fontPath);
    if (index === -1) return false;
    this.fonts.splice(index, 1);
    return true;
  }

  findOrFail(name: string, style: string | null): SystemIndexFont[] {
    const result = this.find(name, style, null);
    if (result.length === 0) {
      throw new FontIndexCorrupted(`No index entry for ${name} (${style ?? 'any style'})`);
    }
    return result;
  }

  toData(): CollectionFileData {
    return {
      last_scan_time: this.lastScanTime,
      directory_mtimes: this.directoryMtimes,
      fonts: this.fonts.map((font) => font.data),
    };
  }
}

export async function collectDirectoryMtimes(directories: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const dir of directories) {
    const stats = await statOrNull(dir);
    result.push(`${dir}:${stats ? Math.floor(stats.mtimeMs) : 0}`);
  }
  return result.sort();
}

async function statOrNull(p: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stats = await fsp.stat(p);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

export async function loadCollection(indexPath: string): Promise<SystemIndexFontCollection> {
  try {
    const text = await fsp.readFile(indexPath, 'utf8');
    const parsed = yaml.parse(text);
    return SystemIndexFontCollection.fromData(parsed as CollectionFileData);
  } catch {
    return SystemIndexFontCollection.empty();
  }
}

export async function saveCollection(
  indexPath: string,
  collection: SystemIndexFontCollection,
): Promise<void> {
  await atomicWriteFile(indexPath, yaml.stringify(collection.toData(), { lineWidth: 1000 }));
}
