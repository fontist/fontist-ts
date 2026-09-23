import * as path from 'node:path';
import type { UI } from '../../ui/ui.js';
import { extractFontMetadata } from '../fontMetadataExtractor.js';
import { FontMetadata } from '../models/fontMetadata.js';

export interface ImportStyleHash {
  family_name: string | null;
  type: string | null;
  preferred_family_name?: string | null;
  preferred_type?: string | null;
  full_name: string | null;
  post_script_name: string | null;
  version: string | null;
  description: string | null;
  copyright: string | null;
  font?: string | null;
  source_font?: string | null;
}

/** One font face prepared for formula generation (Ruby Otf::FontFile).
 * Filenames are kept exactly as found in the archive — never standardized. */
export class ImportFontFile {
  private readonly metadata: FontMetadata;
  private readonly namePrefix: string | null;

  constructor(
    readonly path: string,
    options: { namePrefix?: string | null; metadata?: FontMetadata; ui?: UI } = {},
  ) {
    this.namePrefix = options.namePrefix ?? null;
    if (options.metadata) {
      this.metadata = options.metadata;
    } else {
      try {
        this.metadata = extractFontMetadata(path);
      } catch (err) {
        options.ui?.error(
          `WARN: Could not extract metadata from ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.metadata = minimalMetadata(path);
      }
    }
  }

  toStyle(): Partial<ImportStyleHash> {
    return compact({
      family_name: this.familyName,
      type: this.type,
      preferred_family_name: this.preferredFamilyName,
      preferred_type: this.preferredType,
      full_name: this.fullName,
      post_script_name: this.postScriptName,
      version: this.version,
      description: this.description,
      copyright: this.copyright,
      font: this.font,
      source_font: this.sourceFont,
    });
  }

  toCollectionStyle(): Partial<ImportStyleHash> {
    const style = { ...this.toStyle() };
    delete style['font'];
    delete style['source_font'];
    return style;
  }

  get familyName(): string {
    const name = this.metadata.familyName ?? 'Unknown';
    return this.namePrefix ? `${this.namePrefix}${name}` : name;
  }

  get type(): string {
    return this.metadata.subfamilyName ?? 'Regular';
  }

  get preferredFamilyName(): string | null {
    const name = this.metadata.preferredFamilyName;
    if (!name) return null;
    return this.namePrefix ? `${this.namePrefix}${name}` : name;
  }

  get preferredType(): string | null {
    return this.metadata.preferredSubfamilyName;
  }

  get fullName(): string | null {
    return this.metadata.fullName;
  }

  get postScriptName(): string | null {
    return this.metadata.postscriptName;
  }

  get version(): string | null {
    return this.metadata.version;
  }

  get description(): string | null {
    return this.metadata.description;
  }

  get font(): string {
    return path.basename(this.path);
  }

  /** Kept for formula-shape parity: only used when font != original name. */
  get sourceFont(): string | null {
    return null;
  }

  get copyright(): string | null {
    return this.metadata.copyright;
  }

  get homepage(): string | null {
    return this.metadata.vendorUrl;
  }

  get licenseUrl(): string | null {
    return this.metadata.licenseUrl;
  }
}

function compact(style: ImportStyleHash): Partial<ImportStyleHash> {
  const out: Partial<ImportStyleHash> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== null && value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function minimalMetadata(filePath: string): FontMetadata {
  const base = path.basename(filePath, path.extname(filePath));
  return FontMetadata.fromYamlObject({
    family_name: base,
    subfamily_name: 'Regular',
  }) as FontMetadata;
}
