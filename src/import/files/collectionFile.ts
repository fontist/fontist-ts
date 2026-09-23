import { readFileSync } from 'node:fs';
import type { UI } from '../../ui/ui.js';
import { DfontCollection } from '../../fonts/sfnt/dfont.js';
import { SfntCollection } from '../../fonts/sfnt/collection.js';
import { FontFile } from '../../fonts/fontFile.js';
import { detectFormat } from '../../fonts/sfnt/magic.js';
import { ImportFontFile } from '../otf/fontFile.js';
import { type FontParsingErrorCollector } from '../fontParsingErrorCollector.js';
import { FontMetadata } from '../models/fontMetadata.js';

function buildMetadataFromFace(path: string, faceIndex: number): FontMetadata {
  const bytes = readFileSync(path);
  const font = FontFile.fromBytes(bytes, path, { collectionIndex: faceIndex });
  return FontMetadata.fromYamlObject({
    family_name: font.familyName,
    subfamily_name: font.subfamilyName,
    full_name: font.fullName,
    postscript_name: font.postScriptName,
    preferred_family_name: font.preferredFamilyName,
    preferred_subfamily_name: font.preferredSubfamilyName,
    version: font.version?.replace(/^Version\s+/i, '') ?? null,
    copyright: font.copyright,
    description: font.licenseDescription,
    vendor_url: font.vendorUrl,
    license_url: font.licenseUrl,
    font_format: font.sfntVersionTag === 'OTTO' ? 'cff' : 'truetype',
    is_variable: font.isVariable,
  }) as FontMetadata;
}

function faceCountFor(path: string, bytes: Buffer): number {
  // Collections are detected by content, not extension (a collection may
  // have an unusual extension in the archive).
  const format = detectFormat(bytes);
  if (format === 'ttc' || format === 'otc') {
    return new SfntCollection(bytes).faceCount();
  }
  if (format === 'dfont') {
    return new DfontCollection(bytes).faceCount;
  }
  throw new Error(`Not a font collection: ${path}`);
}

/** A font collection file (TTC/OTC/dfont) with one ImportFontFile per
 * extractable face (Ruby Files::CollectionFile). Filenames stay exactly as
 * found in the archive. */
export class CollectionFile {
  private constructor(
    private readonly filePath: string,
    readonly fonts: ImportFontFile[],
  ) {}

  static fromPath(
    path: string,
    options: { namePrefix?: string | null; errorCollector?: FontParsingErrorCollector; ui?: UI } = {},
  ): CollectionFile | null {
    try {
      const bytes = readFileSync(path);
      const count = faceCountFor(path, bytes);
      const fonts: ImportFontFile[] = [];
      for (let index = 0; index < count; index++) {
        try {
          const metadata = buildMetadataFromFace(path, index);
          fonts.push(new ImportFontFile(path, { namePrefix: options.namePrefix, metadata }));
        } catch (err) {
          options.ui?.debug(
            `Failed to extract font at index ${index} from ${basename(path)}: ${message(err)}`,
          );
        }
      }
      return new CollectionFile(path, fonts);
    } catch (err) {
      options.errorCollector?.add(path, message(err));
      options.ui?.debug(`Failed to build collection from ${basename(path)}: ${message(err)}`);
      return null;
    }
  }

  /** Exact filename from the archive — never modified or standardized. */
  get filename(): string {
    return basename(this.filePath);
  }

  /** Only used when filename != original filename; always null today. */
  get sourceFilename(): string | null {
    return null;
  }
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
