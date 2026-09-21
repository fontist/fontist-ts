import type { WoffTable } from '../woff/woff1.js';

/** Assembles raw tables into a plain SFNT binary (header + sorted directory
 * + 4-byte-aligned table data). Shared by the WOFF1 decoder, the WOFF2
 * metadata decoder, and the web-format encoders. */
export function assembleSfnt(tables: WoffTable[]): Buffer {
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
