import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { createContext, type FontistContext } from '../../src/context.js';
import { FontistPaths } from '../../src/paths.js';
import { UI } from '../../src/ui/ui.js';

export interface CapturedUi extends UI {
  lines: string[];
}

export function capturingUi(): CapturedUi {
  const lines: string[] = [];
  const ui = new UI({
    out: { write: (text) => lines.push(text) },
    err: { write: (text) => lines.push(text) },
    tty: false,
  });
  const captured = ui as CapturedUi;
  captured.lines = lines;
  return captured;
}

export interface TestEnv {
  ctx: FontistContext;
  home: string;
  ui: CapturedUi;
}

/** Creates an isolated context rooted at a tmp dir (never touches ~/.fontist). */
export async function testEnv(options: { platform?: FontistContext['platform'] } = {}): Promise<TestEnv> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-spec-'));
  const ui = capturingUi();
  const paths = new FontistPaths(home);
  const ctx = await createContext({ FONTIST_PATH: home } as NodeJS.ProcessEnv, {
    paths,
    ui,
    platform: options.platform ?? 'macos',
  });
  return { ctx, home, ui };
}

export async function cleanup(env: TestEnv): Promise<void> {
  await fsp.rm(env.home, { recursive: true, force: true });
}

export function formulasRoot(env: TestEnv): string {
  return env.ctx.paths.formulasPath();
}

export async function writeFormula(env: TestEnv, key: string, formula: Record<string, unknown>): Promise<string> {
  const formulaPath = path.join(formulasRoot(env), `${key}.yml`);
  await fsp.mkdir(path.dirname(formulaPath), { recursive: true });
  await fsp.writeFile(formulaPath, yaml.stringify(formula, { lineWidth: 0 }));
  return formulaPath;
}

export function tmpDir(prefix = 'fontist-fixture-'): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

// ── Synthetic font binaries ────────────────────────────────────────────────

interface FaceNames {
  family?: string;
  subfamily?: string;
  fullName?: string;
  postScript?: string;
  version?: string;
  preferredFamily?: string;
  preferredSubfamily?: string;
}

function utf16be(value: string): Buffer {
  const out = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    out.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  return out;
}

function buildNameTable(names: FaceNames): Buffer {
  const entries: { nameId: number; data: Buffer }[] = [];
  if (names.family) entries.push({ nameId: 1, data: utf16be(names.family) });
  if (names.subfamily) entries.push({ nameId: 2, data: utf16be(names.subfamily) });
  if (names.fullName) entries.push({ nameId: 4, data: utf16be(names.fullName) });
  if (names.version) entries.push({ nameId: 5, data: utf16be(names.version) });
  if (names.postScript) entries.push({ nameId: 6, data: utf16be(names.postScript) });
  if (names.preferredFamily) entries.push({ nameId: 16, data: utf16be(names.preferredFamily) });
  if (names.preferredSubfamily) {
    entries.push({ nameId: 17, data: utf16be(names.preferredSubfamily) });
  }
  const count = entries.length;
  const stringOffset = 6 + count * 12;
  const storage: Buffer[] = [];
  let offset = 0;
  const records = Buffer.alloc(count * 12);
  entries.forEach((entry, i) => {
    records.writeUInt16BE(3, i * 12); // platform: Windows
    records.writeUInt16BE(1, i * 12 + 2); // encoding: Unicode BMP
    records.writeUInt16BE(0x0409, i * 12 + 4); // en-US
    records.writeUInt16BE(entry.nameId, i * 12 + 6);
    records.writeUInt16BE(entry.data.length, i * 12 + 8);
    records.writeUInt16BE(offset, i * 12 + 10);
    storage.push(entry.data);
    offset += entry.data.length;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0); // format
  header.writeUInt16BE(count, 2);
  header.writeUInt16BE(stringOffset, 4);
  return Buffer.concat([header, records, ...storage]);
}

function buildFvarTable(axes: { tag: string }[]): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt16BE(1, 0); // major
  header.writeUInt16BE(0, 2); // minor
  header.writeUInt16BE(16, 4); // axesArrayOffset
  header.writeUInt16BE(2, 6); // reserved
  header.writeUInt16BE(axes.length, 8); // axisCount
  header.writeUInt16BE(20, 10); // axisSize
  header.writeUInt16BE(0, 12); // instanceCount
  header.writeUInt16BE(0, 14); // instanceSize
  const axisRecords = axes.map(({ tag }) => {
    const record = Buffer.alloc(20);
    record.write(tag, 0, 'ascii');
    record.writeInt32BE(0, 4); // min
    record.writeInt32BE(400 << 16, 8); // default
    record.writeInt32BE(700 << 16, 12); // max
    return record;
  });
  return Buffer.concat([header, ...axisRecords]);
}

function buildSfnt(versionTag: 'ttf' | 'otf', names: FaceNames, axes: { tag: string }[] = []): Buffer {
  const tables: { tag: string; data: Buffer }[] = [{ tag: 'name', data: buildNameTable(names) }];
  if (axes.length > 0) tables.push({ tag: 'fvar', data: buildFvarTable(axes) });
  tables.push({ tag: 'OS/2', data: Buffer.alloc(4) });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const numTables = tables.length;
  const header = Buffer.alloc(12);
  if (versionTag === 'ttf') {
    header.writeUInt32BE(0x00010000, 0);
  } else {
    header.write('OTTO', 0, 'ascii');
  }
  header.writeUInt16BE(numTables, 4);
  const directory = Buffer.alloc(numTables * 16);
  const chunks: Buffer[] = [header, directory];
  let cursor = 12 + numTables * 16;
  tables.forEach((table, i) => {
    directory.write(table.tag, i * 16, 'ascii');
    directory.writeUInt32BE(0, i * 16 + 4);
    directory.writeUInt32BE(cursor, i * 16 + 8);
    directory.writeUInt32BE(table.data.length, i * 16 + 12);
    chunks.push(table.data);
    const padding = (4 - (table.data.length % 4)) % 4;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    cursor += table.data.length + padding;
  });
  return Buffer.concat(chunks);
}

export function makeTtf(names: FaceNames, axes: { tag: string }[] = []): Buffer {
  return buildSfnt('ttf', names, axes);
}

export function makeOtf(names: FaceNames): Buffer {
  return buildSfnt('otf', names);
}

export function makeTtc(faces: FaceNames[]): Buffer {
  const fonts = faces.map((names) => buildSfnt('ttf', names));
  const header = Buffer.alloc(12);
  header.write('ttcf', 0, 'ascii');
  header.writeUInt16BE(1, 4); // major
  header.writeUInt16BE(0, 6); // minor
  header.writeUInt32BE(faces.length, 8);
  const offsets = Buffer.alloc(faces.length * 4);
  let cursor = header.length + offsets.length;
  fonts.forEach((font, i) => {
    offsets.writeUInt32BE(cursor, i * 4);
    cursor += font.length;
  });
  return Buffer.concat([header, offsets, ...fonts]);
}

// ── Synthetic archives ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds an in-memory zip with stored (uncompressed) entries. */
export function makeZip(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18); // compressed
    local.writeUInt32LE(file.data.length, 22); // uncompressed
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + file.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function fontFileFor(names: FaceNames): { name: string; data: Buffer } {
  return {
    name: `${names.fullName ?? names.family ?? 'Font'}.ttf`,
    data: makeTtf(names),
  };
}
