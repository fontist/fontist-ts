import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { FontFileError } from '../../errors/errors.js';
import { assembleSfnt } from '../sfnt/assemble.js';
import { SfntFont } from '../sfnt/sfntFont.js';
import type { WoffTable } from './woff1.js';

const WOFF2_HEADER_SIZE = 48;

/** Known table tags in WOFF2's defined order; an index below 63 is encoded
 * in the flags byte itself, higher tags are stored after it. */
const KNOWN_TAGS: readonly string[] = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ',
  'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp',
  'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF',
  'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc',
  'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx',
  'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const KNOWN_TAG_INDEX = new Map(KNOWN_TAGS.map((tag, index) => [tag, index]));

interface Woff2DirectoryEntry {
  tag: string;
  origLength: number;
  transformVersion: number;
  transformLength: number | null;
}

interface Woff2Header {
  flavor: number;
  numTables: number;
  totalSfntSize: number;
  totalCompressedSize: number;
}

function readHeader(bytes: Uint8Array): Woff2Header {
  if (bytes.length < WOFF2_HEADER_SIZE) {
    throw new FontFileError('WOFF2 header is truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    flavor: view.getUint32(4),
    numTables: view.getUint16(12),
    totalSfntSize: view.getUint32(16),
    totalCompressedSize: view.getUint32(20),
  };
}

function readBase128(bytes: Uint8Array, offset: { value: number }): number {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[offset.value];
    if (byte === undefined) throw new FontFileError('WOFF2 directory is truncated');
    offset.value += 1;
    if (result > 0x0fffffff && i === 0) {
      throw new FontFileError('WOFF2 uintBase128 value overflows');
    }
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return result >>> 0;
    if (result > 0x01ffffff) {
      throw new FontFileError('WOFF2 uintBase128 value overflows');
    }
  }
  throw new FontFileError('WOFF2 uintBase128 encoding exceeds 5 bytes');
}

function readDirectory(bytes: Uint8Array, header: Woff2Header): { entries: Woff2DirectoryEntry[]; end: number } {
  const entries: Woff2DirectoryEntry[] = [];
  const offset = { value: WOFF2_HEADER_SIZE };
  for (let i = 0; i < header.numTables; i++) {
    const flags = bytes[offset.value];
    if (flags === undefined) throw new FontFileError('WOFF2 directory is truncated');
    offset.value += 1;
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 0x3f) {
      tag = String.fromCharCode(
        bytes[offset.value]!,
        bytes[offset.value + 1]!,
        bytes[offset.value + 2]!,
        bytes[offset.value + 3]!,
      );
      offset.value += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex] ?? (() => { throw new FontFileError(`WOFF2 unknown tag index: ${tagIndex}`); })();
    }
    const transformVersion = (flags >> 6) & 0x03;
    const origLength = readBase128(bytes, offset);
    let transformLength: number | null = null;
    if (transformVersion !== 0) {
      transformLength = readBase128(bytes, offset);
    }
    entries.push({ tag, origLength, transformVersion, transformLength });
  }
  return { entries, end: offset.value };
}

function decodedLength(entry: Woff2DirectoryEntry): number {
  return entry.transformLength ?? entry.origLength;
}

export interface DecodedWoff2 {
  flavor: number;
  /** Reconstructed untransformed tables (transformed glyf/loca/hmtx streams
   * are consumed but not rebuilt — sufficient for font metadata). */
  tables: WoffTable[];
  isVariable: boolean;
}

/** WOFF2 decoder: brotli-inflates the shared table stream and returns the
 * untransformed tables. Transformed glyf/loca/hmtx payloads are skipped
 * (their bytes are consumed to walk the stream) because Fontist metadata
 * (name, fvar, OS/2, ...) lives only in untransformed tables. */
export function decodeWoff2(bytes: Uint8Array): DecodedWoff2 {
  const header = readHeader(bytes);
  const { entries, end } = readDirectory(bytes, header);
  const compressed = bytes.subarray(end, end + header.totalCompressedSize);
  if (compressed.length !== header.totalCompressedSize) {
    throw new FontFileError('WOFF2 compressed data block is truncated');
  }
  let data: Buffer;
  try {
    data = brotliDecompressSync(compressed);
  } catch (err) {
    throw new FontFileError(`WOFF2 brotli stream could not be decompressed (${String(err)})`);
  }

  const tables: WoffTable[] = [];
  let cursor = 0;
  let isVariable = false;
  for (const entry of entries) {
    const length = decodedLength(entry);
    if (cursor + length > data.length) {
      throw new FontFileError(`WOFF2 table stream is shorter than the directory declares (${entry.tag})`);
    }
    if (entry.tag === 'fvar') isVariable = true;
    if (entry.transformVersion === 0) {
      tables.push({ tag: entry.tag, checksum: 0, data: Buffer.from(data.subarray(cursor, cursor + length)) });
    }
    cursor += length;
  }
  return { flavor: header.flavor, tables, isVariable };
}

/** Convenience: decode a WOFF2 font into an SfntFont over its untransformed
 * tables (name, fvar, ...), suitable for metadata reads. */
export function loadWoff2(bytes: Uint8Array): SfntFont {
  const decoded = decodeWoff2(bytes);
  return new SfntFont(assembleSfnt(decoded.tables));
}

/** WOFF2 encoder with null transforms: every table is stored as-is, the
 * concatenated table bodies are brotli-compressed into one stream. */
export function encodeWoff2(tables: WoffTable[], flavor: number): Buffer {
  if (tables.length === 0) {
    throw new FontFileError('WOFF2 encoding requires at least one table');
  }
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directoryChunks: Buffer[] = [];
  const dataChunks: Buffer[] = [];
  for (const table of sorted) {
    const tagIndex = KNOWN_TAG_INDEX.get(table.tag);
    if (tagIndex !== undefined && tagIndex < 0x3f) {
      directoryChunks.push(Buffer.from([tagIndex]));
    } else {
      directoryChunks.push(Buffer.from([0x3f]), Buffer.from(table.tag, 'ascii'));
    }
    directoryChunks.push(writeBase128(table.data.length));
    dataChunks.push(table.data);
  }
  const uncompressedData = Buffer.concat(dataChunks);
  const compressed = brotliCompressSync(uncompressedData);

  const directorySize = directoryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const totalLength = WOFF2_HEADER_SIZE + directorySize + compressed.length;

  const header = Buffer.alloc(WOFF2_HEADER_SIZE);
  header.write('wOF2', 0, 'ascii');
  header.writeUInt32BE(flavor >>> 0, 4);
  header.writeUInt32BE(totalLength, 8);
  header.writeUInt16BE(sorted.length, 12);
  header.writeUInt16BE(0, 14); // reserved
  header.writeUInt32BE(assembleSfnt(sorted).length, 16); // totalSfntSize
  header.writeUInt32BE(compressed.length, 20); // totalCompressedSize
  header.writeUInt16BE(1, 24); // majorVersion
  header.writeUInt16BE(0, 26); // minorVersion
  // metaOffset/metaLength/metaOrigLength/privOffset/privLength stay zero.

  return Buffer.concat([header, ...directoryChunks, compressed]);
}

function writeBase128(value: number): Buffer {
  if (value < 0 || value > 0xffffffff) {
    throw new FontFileError(`WOFF2 uintBase128 out of range: ${value}`);
  }
  let remaining = value;
  const bytes: number[] = [];
  bytes.unshift(remaining & 0x7f);
  remaining >>>= 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return Buffer.from(bytes);
}
