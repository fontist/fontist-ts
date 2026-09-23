import { readFileSync } from 'node:fs';
import { FontExtractError } from '../errors/errors.js';
import { FontFile } from '../fonts/fontFile.js';
import { FontMetadata } from './models/fontMetadata.js';

function loadFont(filePath: string): FontFile {
  const bytes = readFileSync(filePath);
  return FontFile.fromBytes(bytes, filePath);
}

function detectFontFormat(font: FontFile): string {
  const version = font.sfntVersionTag;
  if (version === 'OTTO') return 'cff';
  if (version === '\x00\x01\x00\x00' || version === 'true') return 'truetype';
  return 'unknown';
}

function buildMetadata(font: FontFile): FontMetadata {
  return FontMetadata.fromYamlObject({
    family_name: font.familyName,
    subfamily_name: font.subfamilyName,
    full_name: font.fullName,
    postscript_name: font.postScriptName,
    preferred_family_name: font.preferredFamilyName,
    preferred_subfamily_name: font.preferredSubfamilyName,
    version: cleanVersion(font.version),
    copyright: font.copyright,
    description: font.licenseDescription,
    vendor_url: font.vendorUrl,
    license_url: font.licenseUrl,
    font_format: detectFontFormat(font),
    is_variable: font.isVariable,
  }) as FontMetadata;
}

/** Extracts import metadata from a font file (Ruby FontMetadataExtractor).
 * Collections are read at face 0; failures raise FontExtractError. */
export class FontMetadataExtractor {
  constructor(private readonly filePath: string) {}

  extract(): FontMetadata {
    try {
      return buildMetadata(loadFont(this.filePath));
    } catch (err) {
      throw new FontExtractError(
        `Failed to extract metadata from ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function extractFontMetadata(filePath: string): FontMetadata {
  return new FontMetadataExtractor(filePath).extract();
}

export function cleanVersion(version: string | null): string | null {
  if (!version) return null;
  return version.replace(/^Version\s+/i, '');
}
