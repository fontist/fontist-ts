import type { FontistContext } from '../../../context.js';
import { Downloader } from '../../../download/downloader.js';
import { FontMetadataExtractor } from '../../fontMetadataExtractor.js';
import type { FontFamily } from '../models/fontFamily.js';
import type { FormulaHash } from './formulaHash.js';

export class ArgumentError extends Error {}

export interface BuilderDeps {
  githubIndex: Map<string, FontFamily>;
  ttfFiles: Map<string, Record<string, string>>;
  woff2Files: Map<string, Record<string, string>>;
  ctx: FontistContext;
}

/** Shared logic of the versioned Google formula builders (Ruby
 * BaseFormulaBuilder). */
export abstract class BaseFormulaBuilder {
  constructor(
    readonly family: FontFamily,
    protected readonly deps: BuilderDeps,
  ) {}

  abstract version(): number;

  abstract build(): Promise<FormulaHash>;

  githubFamily(): FontFamily | null {
    return this.deps.githubIndex.get(this.family.family ?? '') ?? null;
  }

  formulaName(): string {
    return (this.family.family ?? '').toLowerCase().replace(/\s+/g, '_');
  }

  defaultDescription(): string {
    return `${this.family.family} font family`;
  }

  defaultHomepage(): string {
    return `https://fonts.google.com/specimen/${(this.family.family ?? '').replace(/\s+/g, '+')}`;
  }

  buildLicenseInfo(): [string, string] {
    const licenseText = this.githubFamily()?.licenseText;
    return licenseText
      ? ['https://scripts.sil.org/OFL', licenseText]
      : ['https://scripts.sil.org/OFL', 'SIL Open Font License v1.1'];
  }

  variantToType(variant: string): string {
    if (variant === 'regular') return 'Regular';
    if (variant === 'italic') return 'Italic';
    const italic = variant.match(/^(\d+)italic$/);
    if (italic) return `${italic[1]} Italic`;
    if (/^\d+$/.test(variant)) return variant;
    return variant.charAt(0).toUpperCase() + variant.slice(1);
  }

  /** Downloads a font through the Fontist cache and extracts import metadata. */
  protected async downloadAndExtract(url: string): Promise<FontMetadataLike> {
    const downloader = new Downloader(this.deps.ctx);
    const downloaded = await downloader.download(url, { progress: false });
    const metadata = new FontMetadataExtractor(downloaded.path).extract();
    return {
      familyName: metadata.familyName,
      subfamilyName: metadata.subfamilyName,
      fullName: metadata.fullName,
      postscriptName: metadata.postscriptName,
      version: metadata.version,
      copyright: metadata.copyright,
      preferredFamilyName: metadata.preferredFamilyName,
      preferredSubfamilyName: metadata.preferredSubfamilyName,
      description: metadata.description,
      isVariable: metadata.isVariable,
    };
  }

  protected buildStyleData(metadata: FontMetadataLike, filename: string): Record<string, unknown> {
    return compact({
      family_name: metadata.familyName,
      type: metadata.subfamilyName,
      full_name: metadata.fullName,
      post_script_name: metadata.postscriptName,
      version: metadata.version,
      copyright: metadata.copyright,
      font: filename,
      preferred_family_name: metadata.preferredFamilyName,
      preferred_type: metadata.preferredSubfamilyName,
      description: metadata.description,
    });
  }

  protected groupFontsBySubfamily(fonts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const font of fonts) {
      const key = String(font['family_name'] ?? '');
      const list = groups.get(key) ?? [];
      list.push(font);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([subfamilyName, styles]) => ({
      name: subfamilyName,
      styles,
    }));
  }
}

export interface FontMetadataLike {
  familyName: string | null;
  subfamilyName: string | null;
  fullName: string | null;
  postscriptName: string | null;
  version: string | null;
  copyright: string | null;
  preferredFamilyName: string | null;
  preferredSubfamilyName: string | null;
  description: string | null;
  isVariable: boolean;
}

export type { FormulaHash };

export function extractCopyright(fontsData: Array<Record<string, unknown>>): string | null {
  const styles = fontsData[0]?.['styles'] as Array<Record<string, unknown>> | undefined;
  const copyright = styles?.[0]?.['copyright'];
  return typeof copyright === 'string' ? copyright : null;
}

export function compact(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

export function warn(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}
