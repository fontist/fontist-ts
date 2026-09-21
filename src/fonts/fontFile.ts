import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { inflateSync } from 'node:zlib';
import { FontFileError } from '../errors/errors.js';
import type { UI } from '../ui/ui.js';
import { detectFormat, type FontBinaryFormat } from './sfnt/magic.js';
import { SfntCollection } from './sfnt/collection.js';
import { SfntFont } from './sfnt/sfntFont.js';

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

const WOFF_TABLE_DIR_OFFSET = 44;
const WOFF_TABLE_ENTRY_SIZE = 20;

/** Facade over the SFNT parsers: loads a font file (or one face of a
 * collection) and exposes the metadata Fontist needs. */
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

    if (detected === 'woff2') {
      throw new FontFileError(
        `WOFF2 metadata parsing is not supported yet: ${label} ` +
          '(desktop formats are fully indexed; web formats are matched by filename)',
      );
    }

    const font = detected === 'woff' ? loadWoff1(bytes) : new SfntFont(bytes);
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

interface WoffTable {
  tag: string;
  checksum: number;
  data: Buffer;
}

/** WOFF 1.0 reader: inflates tables and reassembles a plain SFNT font. */
function loadWoff1(bytes: Uint8Array): SfntFont {
  if (bytes.length < WOFF_TABLE_DIR_OFFSET) {
    throw new FontFileError('WOFF header is truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(12);
  const tables: WoffTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const base = WOFF_TABLE_DIR_OFFSET + i * WOFF_TABLE_ENTRY_SIZE;
    if (base + WOFF_TABLE_ENTRY_SIZE > bytes.length) {
      throw new FontFileError('WOFF table directory is truncated');
    }
    const tag = String.fromCharCode(
      bytes[base]!,
      bytes[base + 1]!,
      bytes[base + 2]!,
      bytes[base + 3]!,
    );
    const offset = view.getUint32(base + 4);
    const compLength = view.getUint32(base + 8);
    const origLength = view.getUint32(base + 12);
    const checksum = view.getUint32(base + 16);
    const compressed = bytes.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: inflateWoffTable(compressed, origLength) });
  }
  return new SfntFont(assembleSfnt(tables));
}

function inflateWoffTable(compressed: Uint8Array, origLength: number): Buffer {
  if (compressed.length >= origLength) {
    return Buffer.from(compressed.subarray(0, origLength));
  }
  const inflated = inflateSync(compressed);
  if (inflated.length !== origLength) {
    throw new FontFileError('WOFF table size mismatch after inflation');
  }
  return inflated;
}

function assembleSfnt(tables: WoffTable[]): Buffer {
  const numTables = tables.length;
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);

  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const directory = Buffer.alloc(numTables * 16);
  const chunks: Buffer[] = [header, directory];
  let cursor = header.length + directory.length;
  sorted.forEach((table, i) => {
    const record = i * 16;
    directory.write(table.tag, record, 'ascii');
    directory.writeUInt32BE(table.checksum, record + 4);
    directory.writeUInt32BE(cursor, record + 8);
    directory.writeUInt32BE(table.data.length, record + 12);
    chunks.push(table.data);
    const padding = (4 - (table.data.length % 4)) % 4;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    cursor += table.data.length + padding;
  });
  return Buffer.concat(chunks);
}
