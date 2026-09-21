import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { FontFileError } from '../errors/errors.js';
import type { UI } from '../ui/ui.js';
import { detectFormat, type FontBinaryFormat } from './sfnt/magic.js';
import { SfntCollection } from './sfnt/collection.js';
import { SfntFont } from './sfnt/sfntFont.js';
import { loadWoff1 } from './woff/woff1.js';
import { loadWoff2 } from './woff/woff2.js';

export interface FontFileInfo {
  format: FontBinaryFormat;
  familyName: string | null;
  subfamilyName: string | null;
  fullName: string | null;
  postScriptName: string | null;
  preferredFamilyName: string | null;
  preferredSubfamilyName: string | null;
  version: string | null;
  isVariable: boolean;
  variableAxes: string[];
  collectionIndex: number | null;
}

/** Facade over the font parsers: loads a font file (or one face of a
 * collection) and exposes the metadata Fontist needs. WOFF/WOFF2 are
 * decoded for indexing; collections read one face at a time. */
export class FontFile {
  private constructor(private readonly info: FontFileInfo) {}

  static async fromPath(
    filePath: string,
    options: { collectionIndex?: number; ui?: UI } = {},
  ): Promise<FontFile> {
    let bytes: Buffer;
    try {
      bytes = await fsp.readFile(filePath);
    } catch (err) {
      throw new FontFileError(`Font file could not be read: ${filePath} (${String(err)})`);
    }
    return FontFile.fromBytes(bytes, filePath, options);
  }

  static fromBytes(
    bytes: Uint8Array,
    label: string,
    options: { collectionIndex?: number; ui?: UI } = {},
  ): FontFile {
    const detected = detectFormat(bytes);
    if (detected === null) {
      throw new FontFileError(`Unknown font format: ${label}`);
    }
    const extension = path.extname(label).replace('.', '').toLowerCase();
    if (options.ui && extension && isFontExtension(extension) && extension !== detected) {
      options.ui.debug(
        `Font extension mismatch: ${label} looks like ${detected} (extension says ${extension})`,
      );
    }

    if (detected === 'ttc' || detected === 'otc') {
      const collection = new SfntCollection(bytes);
      const index = options.collectionIndex ?? 0;
      const face = collection.face(index);
      return new FontFile(buildInfo(detected, face, index));
    }

    const font =
      detected === 'woff' ? loadWoff1(bytes) : detected === 'woff2' ? loadWoff2(bytes) : new SfntFont(bytes);
    return new FontFile(buildInfo(detected, font, null));
  }

  get format(): FontBinaryFormat {
    return this.info.format;
  }
  get familyName(): string | null {
    return this.info.familyName;
  }
  get subfamilyName(): string | null {
    return this.info.subfamilyName;
  }
  get fullName(): string | null {
    return this.info.fullName;
  }
  get postScriptName(): string | null {
    return this.info.postScriptName;
  }
  get preferredFamilyName(): string | null {
    return this.info.preferredFamilyName;
  }
  get preferredSubfamilyName(): string | null {
    return this.info.preferredSubfamilyName;
  }
  get version(): string | null {
    return this.info.version;
  }
  get isVariable(): boolean {
    return this.info.isVariable;
  }
  get variableAxes(): string[] {
    return this.info.variableAxes;
  }
  get collectionIndex(): number | null {
    return this.info.collectionIndex;
  }

  toInfo(): FontFileInfo {
    return { ...this.info };
  }
}

function buildInfo(
  format: FontBinaryFormat,
  font: SfntFont,
  collectionIndex: number | null,
): FontFileInfo {
  font.validate();
  return {
    format,
    familyName: font.familyName(),
    subfamilyName: font.subfamilyName(),
    fullName: font.fullName(),
    postScriptName: font.postScriptName(),
    preferredFamilyName: font.preferredFamilyName(),
    preferredSubfamilyName: font.preferredSubfamilyName(),
    version: font.version(),
    isVariable: font.isVariable(),
    variableAxes: font.variableAxes().map((axis) => axis.tag),
    collectionIndex,
  };
}

export function isFontExtension(extension: string): boolean {
  return ['ttf', 'otf', 'ttc', 'otc', 'dfont', 'woff', 'woff2'].includes(extension.toLowerCase());
}
