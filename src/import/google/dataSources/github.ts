import { promises as fsp, statSync } from 'node:fs';
import * as path from 'node:path';
import { MetadataAdapter } from '../metadataAdapter.js';
import { parseTextproto, findFields } from '../textproto.js';
import { FontFamily } from '../models/fontFamily.js';
import { ImportFontFile } from '../../otf/fontFile.js';

const LICENSE_DIRS = ['ofl', 'apache', 'ufl'];
const LICENSE_FILES = ['OFL.txt', 'LICENSE.txt', 'LICENCE.txt', 'UFL.txt'];

/** Reads font families from a local google/fonts checkout: METADATA.pb,
 * font files, license, and description (Ruby DataSources::Github). */
export class GithubDataSource {
  readonly sourcePath: string;

  constructor(sourcePath: string) {
    const resolved = path.resolve(sourcePath);
    if (!existsDir(resolved)) {
      throw new ArgumentError(`Source path does not exist: ${sourcePath}`);
    }
    if (!LICENSE_DIRS.some((dir) => existsDir(path.join(resolved, dir)))) {
      throw new ArgumentError(`Source path does not contain expected font directories: ${sourcePath}`);
    }
    this.sourcePath = resolved;
  }

  private cache: FontFamily[] | null = null;

  async fetch(): Promise<FontFamily[]> {
    if (this.cache) return this.cache;
    const families: FontFamily[] = [];
    for (const dir of await this.fontDirectories()) {
      try {
        families.push(await this.parseFamily(dir));
      } catch (err) {
        process.stderr.write(
          `Warning: Failed to parse ${dir}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    this.cache = families;
    return families;
  }

  async fetchFamily(name: string): Promise<FontFamily | null> {
    const normalizedName = normalizeFamilyName(name);
    for (const dir of await this.fontDirectories()) {
      if (path.basename(dir) === normalizedName) return this.parseFamily(dir);
    }
    return null;
  }

  clearCache(): void {
    this.cache = null;
  }

  private async fontDirectories(): Promise<string[]> {
    const dirs: string[] = [];
    for (const licenseDir of LICENSE_DIRS) {
      const licensePath = path.join(this.sourcePath, licenseDir);
      if (!existsDir(licensePath)) continue;
      for (const entry of await fsp.readdir(licensePath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const familyDir = path.join(licensePath, entry.name);
        if (existsFileSync(path.join(familyDir, 'METADATA.pb'))) dirs.push(familyDir);
      }
    }
    return dirs;
  }

  private async parseFamily(familyDir: string): Promise<FontFamily> {
    const metadataPath = path.join(familyDir, 'METADATA.pb');
    const content = await fsp.readFile(metadataPath, 'utf8');
    const message = parseTextproto(content);
    const metadata = MetadataAdapter.adapt(message);

    const fontFilesData = await this.parseFontFiles(familyDir, metadata.filenames());
    const licenseInfo = await readLicense(familyDir);
    const description = await readDescription(familyDir);

    return FontFamily.fromYamlObject({
      family: metadata.name,
      variants: this.extractVariants(metadata),
      subsets: findFields(message, 'subsets')
        .map((f) => f.value)
        .filter((v): v is string => v !== null),
      category: normalizeCategory(metadata.category),
      designer: metadata.designer,
      license: normalizeLicense(metadata.license),
      license_text: licenseInfo.text,
      description,
      homepage: licenseInfo.homepage,
      font_file_data: fontFilesData,
    }) as FontFamily;
  }

  private async parseFontFiles(familyDir: string, filenames: string[]): Promise<unknown> {
    const fontData: Array<Record<string, unknown>> = [];
    for (const filename of filenames) {
      const fontPath = path.join(familyDir, filename);
      if (!existsFileSync(fontPath)) continue;
      try {
        const fontFile = new ImportFontFile(fontPath);
        fontData.push({
          filename,
          family_name: fontFile.familyName,
          type: fontFile.type,
          full_name: fontFile.fullName,
          post_script_name: fontFile.postScriptName,
          version: fontFile.version,
          copyright: fontFile.copyright,
          description: fontFile.description,
        });
      } catch (err) {
        process.stderr.write(
          `Warning: Failed to parse font file ${filename}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    return fontData;
  }

  private extractVariants(metadata: { fonts: Array<{ weight: number | null; style: string | null }> | null }): string[] {
    return [
      ...new Set(
        (metadata.fonts ?? []).map((font) => variantName(font.weight, font.style)).filter((v) => v !== null),
      ),
    ];
  }
}

export class ArgumentError extends Error {}

function variantName(weight: number | null, style: string | null): string | null {
  if (weight === null || style === null) return null;
  if (weight === 400 && style === 'normal') return 'regular';
  if (weight === 400 && style === 'italic') return 'italic';
  if (style === 'normal') return String(weight);
  return `${weight}${style}`;
}

function normalizeCategory(category: string | null): string | null {
  if (!category) return null;
  switch (category.toUpperCase()) {
    case 'SANS_SERIF':
      return 'sans-serif';
    case 'SERIF':
      return 'serif';
    case 'DISPLAY':
      return 'display';
    case 'HANDWRITING':
      return 'handwriting';
    case 'MONOSPACE':
      return 'monospace';
    default:
      return category.toLowerCase().replaceAll('_', '-');
  }
}

function normalizeLicense(license: string | null): string | null {
  if (!license) return null;
  switch (license.toUpperCase()) {
    case 'APACHE2':
      return 'Apache-2.0';
    case 'OFL':
      return 'OFL-1.1';
    case 'UFL':
      return 'UFL-1.0';
    default:
      return license;
  }
}

function normalizeFamilyName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

async function readLicense(familyDir: string): Promise<{ text: string | null; homepage: string | null }> {
  const licenseFile = LICENSE_FILES.find((name) => existsFileSync(path.join(familyDir, name)));
  if (!licenseFile) return { text: null, homepage: null };
  const content = await fsp.readFile(path.join(familyDir, licenseFile), 'utf8');
  const homepage = content.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
  return { text: content, homepage };
}

async function readDescription(familyDir: string): Promise<string | null> {
  const descFile = path.join(familyDir, 'DESCRIPTION.en_us.html');
  if (!existsFileSync(descFile)) return null;
  const content = await fsp.readFile(descFile, 'utf8');
  return content
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function existsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFileSync(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
