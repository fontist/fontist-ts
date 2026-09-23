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

/** One indexed font entry, persisted as a YAML mapping
 * (Ruby `SystemIndexFont`; `type` is the YAML key of `subfamily`). */
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

  get preferredSubfamilyName(): string | null {
    return this.data.preferred_subfamily_name;
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

  /** Ruby find semantics: family name (case-insensitive), plus the type
   * when a style is requested. Full and preferred names are stored but
   * never matched. */
  matches(name: string, style: string | null): boolean {
    if (!equalsIgnoreCase(this.familyName, name)) return false;
    if (style === null) return true;
    return equalsIgnoreCase(this.subfamily, style);
  }

  matchesFormat(matcher: FormatMatcher): boolean {
    return matcher.matchesIndexedFont({
      format: this.format,
      isVariable: this.isVariable,
      variableAxes: this.variableAxes,
    });
  }
}

interface CollectionFileData {
  last_scan_time: number;
  directory_mtimes: string[];
  fonts: SystemIndexFontData[];
}

const SCAN_FRESHNESS_MS = 30 * 60 * 1000;
const LOCK_ADOPTION_MS = 60 * 1000;

/** The persisted font collection backing an installed-font index, ported
 * from Ruby `SystemIndexFontCollection`: change detection with a session
 * verification flag, freshness window, directory-mtime short-circuit,
 * required-key validation, and cross-process rebuild adoption. */
export class SystemIndexFontCollection {
  private fonts: SystemIndexFont[];
  private lastScanTime: number;
  private directoryMtimes: string[];
  private indexCheckDone = false;
  private cachedCurrentPaths: string[] | null = null;
  readOnly = false;

  private constructor(
    fonts: SystemIndexFont[],
    lastScanTime: number,
    directoryMtimes: string[],
  ) {
    this.fonts = fonts;
    this.lastScanTime = lastScanTime;
    this.directoryMtimes = directoryMtimes;
  }

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

  adopt(other: SystemIndexFontCollection): void {
    this.replaceAll(other.all(), other.lastScanTime, other.directoryMtimes);
    this.resetVerification();
  }

  all(): SystemIndexFont[] {
    return this.fonts;
  }

  /** Ruby `find`: family match (+ type when a style is given), then
   * format-spec filtering; null when nothing matches or the index is
   * empty. Change detection is orchestrated by the owning index service. */
  find(name: string, style: string | null, matcher: FormatMatcher | null): SystemIndexFont[] | null {
    if (this.fonts.length === 0) return null;
    const found = this.fonts.filter((font) => font.matches(name, style));
    const filtered =
      matcher !== null && matcher.hasConstraints() ? found.filter((f) => f.matchesFormat(matcher)) : found;
    return filtered.length > 0 ? filtered : null;
  }

  /** Ruby `index_changed?`: empty index is always stale; one unchanged
   * verification short-circuits the session; freshness window next;
   * directory mtimes last (and extend the scan time when unchanged). */
  async indexChanged(
    directories: string[],
    currentPaths: () => Promise<string[]>,
  ): Promise<boolean> {
    if (this.fonts.length === 0) return true;
    if (this.indexCheckDone) return false;
    if (Date.now() - this.lastScanTime < SCAN_FRESHNESS_MS && this.lastScanTime > 0) {
      this.indexCheckDone = true;
      return false;
    }
    const currentMtimes = await collectDirectoryMtimes(directories);
    if (
      this.directoryMtimes.length > 0 &&
      currentMtimes.length === this.directoryMtimes.length &&
      currentMtimes.every((value, idx) => value === this.directoryMtimes[idx])
    ) {
      this.indexCheckDone = true;
      this.lastScanTime = Date.now();
      return false;
    }
    if (this.cachedCurrentPaths === null) {
      this.cachedCurrentPaths = (await currentPaths()).sort();
    }
    const storedPaths = Array.from(new Set(this.fonts.map((f) => f.path))).sort();
    return (
      this.cachedCurrentPaths.length !== storedPaths.length ||
      this.cachedCurrentPaths.some((p, i) => p !== storedPaths[i])
    );
  }

  /** Ruby `mark_verified!` / `reset_verification!`. */
  markVerified(): void {
    this.indexCheckDone = true;
  }

  resetVerification(): void {
    this.indexCheckDone = false;
    this.cachedCurrentPaths = null;
  }

  /** Ruby `check_index`: required keys else FontIndexCorrupted. */
  checkIndex(): void {
    const required: (keyof SystemIndexFontData)[] = ['path', 'full_name', 'family_name', 'type'];
    for (const font of this.fonts) {
      const missing = required.filter((key) => !font.data[key]);
      if (missing.length > 0) {
        throw new FontIndexCorrupted(
          `Index entry ${font.path} misses required attributes: ${missing.join(', ')}. ` +
            'You can remove the index file and try again.',
        );
      }
    }
  }

  addParsed(font: SystemIndexFont): void {
    this.removeByPath(font.path);
    this.fonts.push(font);
    this.lastScanTime = Date.now();
  }

  /** All indexed entries (Ruby collection.fonts). */
  allFonts(): SystemIndexFont[] {
    return this.fonts;
  }

  removeByPath(fontPath: string): boolean {
    const index = this.fonts.findIndex((font) => font.path === fontPath);
    if (index === -1) return false;
    this.fonts.splice(index, 1);
    return true;
  }

  toData(): CollectionFileData {
    return {
      last_scan_time: this.lastScanTime,
      directory_mtimes: this.directoryMtimes,
      fonts: this.fonts.map((font) => font.data),
    };
  }

  get lastScanElapsedTime(): number {
    return this.lastScanTime > 0 ? Date.now() - this.lastScanTime : Number.MAX_SAFE_INTEGER;
  }

  isRecentlyScanned(withinMs = LOCK_ADOPTION_MS): boolean {
    return this.lastScanTime > 0 && Date.now() - this.lastScanTime < withinMs;
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
