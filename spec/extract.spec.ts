import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Archive } from '../src/extract/archive.js';
import { ExtractorRegistry } from '../src/extract/extractor.js';
import { UnknownArchiveError } from '../src/errors/errors.js';
import { cleanup, fontFileFor, makeZip, makeTtf, testEnv, type TestEnv } from './helpers/index.js';

const envs: TestEnv[] = [];

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

function tarGz(files: { name: string; data: Buffer }[]): Buffer {
  // Minimal ustar archive, gzipped.
  const chunks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    const nameBytes = Buffer.from(file.name, 'utf8');
    nameBytes.copy(header, 0);
    header.write('0000644', 100, 'ascii'); // mode
    header.write('0000000', 108, 'ascii'); // uid
    header.write('0000000', 116, 'ascii'); // gid
    header.write(file.data.length.toString(8).padStart(11, '0'), 124, 'ascii'); // size
    header.write('00000000000', 136, 'ascii'); // mtime
    header.write('        ', 148, 'ascii'); // checksum placeholder
    header.write('0', 156, 'ascii'); // type: file
    header.write('ustar', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    const padded = Buffer.alloc(Math.ceil(file.data.length / 512) * 512);
    file.data.copy(padded);
    chunks.push(header, padded);
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

describe('Archive extraction', () => {
  it('extracts flat and nested zips recursively', async () => {
    const e = await env();
    const font = fontFileFor({ family: 'Nested', subfamily: 'Regular', fullName: 'Nested' });
    const inner = makeZip([
      font,
      { name: 'readme.txt', data: Buffer.from('hello') },
    ]);
    const outer = makeZip([
      { name: 'pack/inner.zip', data: inner },
      { name: 'pack/fonts/Outer.ttf', data: makeTtf({ family: 'Outer', fullName: 'Outer' }) },
    ]);
    const zipPath = path.join(e.home, 'outer.zip');
    await fsp.writeFile(zipPath, outer);
    const dest = path.join(e.home, 'dest');
    const archive = new Archive();
    const extracted = await archive.extractAll(zipPath, dest);
    const names = extracted.map((p) => path.relative(dest, p)).sort();
    expect(names).toContain('pack/fonts/Outer.ttf');
    expect(names.some((n) => n.endsWith('Nested.ttf') && n.includes('inner.zip-extracted'))).toBe(true);
    expect(names).not.toContain('readme.txt'.replace('readme', ''));
    const readme = extracted.find((p) => p.endsWith('readme.txt'));
    expect(readme).toBeTruthy();
  });

  it('extracts tar.gz archives', async () => {
    const e = await env();
    const font = fontFileFor({ family: 'Tared', fullName: 'Tared' });
    const tarPath = path.join(e.home, 'pack.tar.gz');
    await fsp.writeFile(tarPath, tarGz([font, { name: 'docs/manual.txt', data: Buffer.from('m') }]));
    const dest = path.join(e.home, 'tar-dest');
    const extracted = await new Archive().extractAll(tarPath, dest);
    const names = extracted.map((p) => path.relative(dest, p)).sort();
    expect(names).toContain('docs/manual.txt');
    expect(names.some((n) => n.endsWith('Tared.ttf'))).toBe(true);
  });

  it('rejects path-traversing zip entries', async () => {
    const e = await env();
    const evil = makeZip([{ name: '../escaped.ttf', data: makeTtf({ family: 'Evil' }) }]);
    const zipPath = path.join(e.home, 'evil.zip');
    await fsp.writeFile(zipPath, evil);
    // yauzl rejects `..` entries itself; safeEntryName is the second guard.
    await expect(new Archive().extractAll(zipPath, path.join(e.home, 'dest'))).rejects.toThrow(
      /invalid relative path|unsafe/,
    );
  });

  it('raises a descriptive error for unknown archive formats', async () => {
    const e = await env();
    const mystery = path.join(e.home, 'mystery.bin');
    await fsp.writeFile(mystery, Buffer.from('definitely not an archive'));
    await expect(new Archive().extractAll(mystery, path.join(e.home, 'dest'))).rejects.toBeInstanceOf(
      UnknownArchiveError,
    );
  });

  it('names the detected-but-unregistered format', async () => {
    const e = await env();
    const sevenZip = path.join(e.home, 'pack.7z');
    await fsp.writeFile(sevenZip, Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(20)]));
    await expect(new Archive().extractAll(sevenZip, path.join(e.home, 'dest'))).rejects.toThrow(/7z/);
  });

  it('exposes a registry that only accepts registered extractors', async () => {
    const registry = new ExtractorRegistry();
    const bytes = makeZip([{ name: 'a.txt', data: Buffer.from('a') }]);
    expect(registry.find(bytes)).toBeNull();
    const { defaultRegistry } = await import('../src/extract/archive.js');
    expect(defaultRegistry().find(bytes)?.formatId).toBe('zip');
  });
});
