import { deflateSync, inflateSync } from 'node:zlib';
import { FontFileError } from '../../errors/errors.js';
import { assembleSfnt } from '../sfnt/assemble.js';
import { SfntFont } from '../sfnt/sfntFont.js';

export interface WoffTable {
  tag: string;
  checksum: number;
  data: Buffer;
}

export const WOFF_TABLE_DIR_OFFSET = 44;
export const WOFF_TABLE_ENTRY_SIZE = 20;

/** WOFF 1.0 decoder: inflates tables and reassembles a plain SFNT font. */
export function loadWoff1(bytes: Uint8Array): SfntFont {
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

const WOFF1_HEADER_SIZE = 44;

/** WOFF 1.0 encoder: zlib-compresses each table (storing it raw when
 * compression does not shrink it) with a sorted directory. */
export function encodeWoff1(tables: WoffTable[], flavor: number): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const compressedTables = sorted.map((table) => {
    const deflated = deflateSync(table.data);
    return deflated.length < table.data.length ? deflated : table.data;
  });
  const directorySize = sorted.length * WOFF_TABLE_ENTRY_SIZE;
  const header = Buffer.alloc(WOFF1_HEADER_SIZE);
  header.write('wOFF', 0, 'ascii');
  header.writeUInt32BE(flavor >>> 0, 4);
  header.writeUInt16BE(sorted.length, 12);
  header.writeUInt16BE(0, 14);
  header.writeUInt32BE(assembleSfnt(tables).length, 16);
  header.writeUInt16BE(1, 20); // majorVersion
  header.writeUInt16BE(0, 22); // minorVersion

  const directory = Buffer.alloc(directorySize);
  const dataChunks: Buffer[] = [];
  let cursor = WOFF1_HEADER_SIZE + directorySize;
  sorted.forEach((table, i) => {
    const data = compressedTables[i]!;
    directory.write(table.tag, i * WOFF_TABLE_ENTRY_SIZE, 'ascii');
    directory.writeUInt32BE(cursor, i * WOFF_TABLE_ENTRY_SIZE + 4);
    directory.writeUInt32BE(data.length, i * WOFF_TABLE_ENTRY_SIZE + 8);
    directory.writeUInt32BE(table.data.length, i * WOFF_TABLE_ENTRY_SIZE + 12);
    directory.writeUInt32BE(table.checksum, i * WOFF_TABLE_ENTRY_SIZE + 16);
    dataChunks.push(data);
    const padding = (4 - (data.length % 4)) % 4;
    if (padding > 0) dataChunks.push(Buffer.alloc(padding));
    cursor += data.length + padding;
  });
  header.writeUInt32BE(cursor, 8); // total file length
  return Buffer.concat([header, directory, ...dataChunks]);
}
