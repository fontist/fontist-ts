import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Archive, defaultRegistry } from '../src/extract/archive.js';
import { ProcessExtractor } from '../src/extract/processExtractor.js';
import { makeTtf } from './helpers/index.js';

const FIXTURES = 'spec/fixtures/archives';

async function tempDir(prefix: string): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('native extractors (7-Zip backed)', () => {
  it('extracts the real fonts.cab fixture', async () => {
    const dest = await tempDir('fontist-cab-');
    try {
      const extracted = await new Archive().extractAll(path.join(FIXTURES, 'fonts.cab'), dest);
      expect(extracted.some((f) => f.endsWith('Marlett.ttf'))).toBe(true);
    } finally {
      await fsp.rm(dest, { recursive: true, force: true });
    }
  });

  it('extracts the real fonts_7z.exe SFX fixture', async () => {
    const dest = await tempDir('fontist-sfx-');
    try {
      const extracted = await new Archive().extractAll(path.join(FIXTURES, 'fonts_7z.exe'), dest);
      expect(extracted.some((f) => f.endsWith('Marlett.ttf'))).toBe(true);
    } finally {
      await fsp.rm(dest, { recursive: true, force: true });
    }
  });

  it('extracts the real fonts.msi fixture', async () => {
    const dest = await tempDir('fontist-msi-');
    try {
      const extracted = await new Archive().extractAll(path.join(FIXTURES, 'fonts.msi'), dest);
      expect(extracted.length).toBeGreaterThan(0);
    } finally {
      await fsp.rm(dest, { recursive: true, force: true });
    }
  });

  it('routes exe SFX (MZ) signatures to the 7-Zip extractor', () => {
    const mzBytes = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)]);
    expect(defaultRegistry().find(mzBytes)?.formatId).toBe('exe-sfx');
  });

  it('detects msi signatures as 7-Zip containers', () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(32)]);
    expect(defaultRegistry().find(ole)?.formatId).toBe('msi');
  });

  it('reports the missing binary clearly', async () => {
    const extractor = new ProcessExtractor('7z', () => true, ['definitely-not-7z-binary']);
    const archivePath = path.join(FIXTURES, 'fonts.cab');
    await expect(extractor.extract(archivePath, await tempDir('fontist-nobin-'))).rejects.toThrow(/7-Zip/);
  });

  it('keeps font binaries out of the archive registry', () => {
    expect(defaultRegistry().find(makeTtf({ family: 'X' }))).toBeNull();
  });
});
