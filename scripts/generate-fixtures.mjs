// One-off generator for spec/fixtures/fonts/*: builds a synthetic TTF and
// converts it to WOFF/WOFF2 with fontTools (reference decoder/encoder).
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

function utf16be(value) {
  const out = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i++) out.writeUInt16BE(value.charCodeAt(i), i * 2);
  return out;
}

function buildNameTable(names) {
  const ids = [[1, 'family'], [2, 'subfamily'], [4, 'fullName'], [6, 'postScript']];
  const entries = ids.map(([id, key]) => ({ nameId: id, data: utf16be(names[key]) }));
  const stringOffset = 6 + entries.length * 12;
  const records = Buffer.alloc(entries.length * 12);
  const storage = [];
  let offset = 0;
  entries.forEach((entry, i) => {
    records.writeUInt16BE(3, i * 12);
    records.writeUInt16BE(1, i * 12 + 2);
    records.writeUInt16BE(0x0409, i * 12 + 4);
    records.writeUInt16BE(entry.nameId, i * 12 + 6);
    records.writeUInt16BE(entry.data.length, i * 12 + 8);
    records.writeUInt16BE(offset, i * 12 + 10);
    storage.push(entry.data);
    offset += entry.data.length;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(entries.length, 2);
  header.writeUInt16BE(stringOffset, 4);
  return Buffer.concat([header, records, ...storage]);
}

function buildSfnt(tables) {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const numTables = tables.length;
  const header = Buffer.alloc(12);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(numTables, 4);
  const directory = Buffer.alloc(numTables * 16);
  const chunks = [header, directory];
  let cursor = 12 + numTables * 16;
  tables.forEach((table, i) => {
    directory.write(table.tag, i * 16, 'ascii');
    directory.writeUInt32BE(cursor, i * 16 + 8);
    directory.writeUInt32BE(table.data.length, i * 16 + 12);
    chunks.push(table.data);
    const padding = (4 - (table.data.length % 4)) % 4;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    cursor += table.data.length + padding;
  });
  return Buffer.concat(chunks);
}

function buildHeadTable() {
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0); // version
  head.writeUInt32BE(0x00010000, 4); // fontRevision
  head.writeUInt32BE(0, 8); // checkSumAdjustment
  head.writeUInt32BE(0x5f0f3cf5, 12); // magicNumber
  head.writeUInt16BE(0, 16); // flags
  head.writeUInt16BE(1000, 18); // unitsPerEm
  head.writeUInt32BE(0, 20); // created
  head.writeUInt32BE(0, 24);
  head.writeUInt32BE(0, 28); // modified
  head.writeUInt32BE(0, 32);
  head.writeInt16BE(0, 36); // xMin
  head.writeInt16BE(0, 38); // yMin
  head.writeInt16BE(1000, 40); // xMax
  head.writeInt16BE(1000, 42); // yMax
  head.writeUInt16BE(0, 44); // macStyle
  head.writeUInt16BE(8, 46); // lowestRecPPEM
  head.writeInt16BE(2, 48); // fontDirectionHint
  head.writeInt16BE(0, 50); // indexToLocFormat
  head.writeInt16BE(0, 52); // glyphDataFormat
  return head;
}

const ttf = buildSfnt([
  { tag: 'name', data: buildNameTable({ family: 'Fixture Sans', subfamily: 'Regular', fullName: 'Fixture Sans Regular', postScript: 'FixtureSans-Regular' }) },
  { tag: 'OS/2', data: Buffer.alloc(4) },
  { tag: 'head', data: buildHeadTable() },
]);
writeFileSync('/tmp/fixture.ttf', ttf);
execSync('python3 -c "from fontTools.ttLib import TTFont; f = TTFont(\'/tmp/fixture.ttf\'); f.flavor = \'woff\'; f.save(\'spec/fixtures/fonts/fixture.woff\'); f.flavor = \'woff2\'; f.save(\'spec/fixtures/fonts/fixture.woff2\')"');
writeFileSync('spec/fixtures/fonts/fixture.ttf', readFileSync('/tmp/fixture.ttf'));
console.log('fixtures written');
