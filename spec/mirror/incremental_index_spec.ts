// Mirrors spec/fontist/indexes/incremental_scanner_spec.rb,
// spec/fontist/indexes/directory_snapshot_spec.rb,
// spec/fontist/indexes/directory_change_spec.rb,
// spec/fontist/indexes/incremental_index_updater_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IncrementalScanner } from '../../src/index/incremental/incrementalScanner.js';
import { DirectorySnapshot } from '../../src/index/incremental/directorySnapshot.js';
import { DirectoryChange } from '../../src/index/incremental/directoryChange.js';
import {
  FileSnapshotStore,
  IncrementalIndexUpdater,
} from '../../src/index/incremental/incrementalIndexUpdater.js';
import { cleanup, makeTtf, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  const fontsDir = path.join(e.home, 'fonts');
  await fsp.mkdir(fontsDir, { recursive: true });
  await fsp.writeFile(path.join(fontsDir, 'A.ttf'), makeTtf({ family: 'A' }));
  return e;
}

describe('IncrementalScanner.scanDirectory', () => {
  it('returns full paths with metadata and signatures', async () => {
    const e = await env();
    const scanned = await IncrementalScanner.scanDirectory(path.join(e.home, 'fonts'));
    expect(scanned).toHaveLength(1);
    expect(scanned[0]!.filename).toBe('A.ttf');
    expect(scanned[0]!.path).toContain('A.ttf');
    expect(scanned[0]!.file_size).toBeGreaterThan(0);
    expect(scanned[0]!.file_mtime).toBeGreaterThan(0);
    expect(scanned[0]!.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty and non-existent directories', async () => {
    const e = await env();
    expect(await IncrementalScanner.scanDirectory(path.join(e.home, 'fonts'))).toHaveLength(1);
    expect(await IncrementalScanner.scanDirectory(path.join(e.home, 'nope'))).toEqual([]);
  });

  it('detects the font format from the header', async () => {
    const e = await env();
    const scanned = await IncrementalScanner.scanDirectory(path.join(e.home, 'fonts'));
    expect(scanned[0]!.format).toBe('truetype');
  });
});

describe('IncrementalScanner.scanWithCache', () => {
  it('reuses cached metadata if the file is unchanged', async () => {
    const e = await env();
    const fontPath = path.join(e.home, 'fonts', 'A.ttf');
    const first = await IncrementalScanner.scanFontFile(fontPath);
    const cached = await IncrementalScanner.scanWithCache(fontPath, first);
    expect(cached).toBe(first);
  });

  it('rescans when the file was modified', async () => {
    const e = await env();
    const fontPath = path.join(e.home, 'fonts', 'A.ttf');
    const first = await IncrementalScanner.scanFontFile(fontPath);
    await fsp.writeFile(fontPath, makeTtf({ family: 'B', subfamily: 'Regular', fullName: 'B' }));
    const cached = await IncrementalScanner.scanWithCache(fontPath, first);
    expect(cached).not.toBe(first);
  });

  it('returns nil if the cached file was deleted', async () => {
    const e = await env();
    const fontPath = path.join(e.home, 'fonts', 'A.ttf');
    const first = await IncrementalScanner.scanFontFile(fontPath);
    await fsp.rm(fontPath);
    expect(await IncrementalScanner.scanWithCache(fontPath, first)).toBeNull();
  });
});

describe('DirectorySnapshot', () => {
  it('creates a snapshot with scanned files and a timestamp', async () => {
    const e = await env();
    const snapshot = await DirectorySnapshot.create(path.join(e.home, 'fonts'));
    expect(snapshot.fileCount).toBe(1);
    expect(snapshot.scannedAt).toBeGreaterThan(0);
  });

  it('restores from hash and queries by filename', async () => {
    const e = await env();
    const created = await DirectorySnapshot.create(path.join(e.home, 'fonts'));
    const restored = DirectorySnapshot.fromHash(created.toObject());
    expect(restored.fileInfo('A.ttf')?.filename).toBe('A.ttf');
    expect(restored.fileInfo('Nope.ttf')).toBeNull();
    expect(restored.hasFile('A.ttf')).toBe(true);
    expect(restored.hasFile('Nope.ttf')).toBe(false);
    expect(restored.olderThan(3600)).toBe(false);
  });
});

describe('DirectoryChange', () => {
  it('detects added, modified, and removed files across snapshots', async () => {
    const e = await env();
    const fontsDir = path.join(e.home, 'fonts');
    // D.ttf exists in BOTH snapshots with same size and mtime-second;
    // only the signature comparison can detect its modification.
    await fsp.writeFile(path.join(fontsDir, 'D.ttf'), makeTtf({ family: 'D' }));
    const oldSnapshot = await DirectorySnapshot.create(fontsDir);

    await fsp.rm(path.join(fontsDir, 'A.ttf'));
    await fsp.writeFile(path.join(fontsDir, 'B.ttf'), makeTtf({ family: 'B' }));
    await fsp.writeFile(path.join(fontsDir, 'C.ttf'), makeTtf({ family: 'C' }));
    const dData = await fsp.readFile(path.join(fontsDir, 'D.ttf'));
    dData[dData.length - 1] = (dData[dData.length - 1] ?? 0) ^ 0xff;
    await fsp.writeFile(path.join(fontsDir, 'D.ttf'), dData);

    const newSnapshot = await DirectorySnapshot.create(fontsDir);
    const changes = DirectoryChange.diff(oldSnapshot, newSnapshot);
    const types = changes.map((c) => c.toObject().change_type).sort();
    expect(types).toEqual(['added', 'added', 'modified', 'removed']);
    expect(changes.find((c) => c.isAdded)?.filename).toBe('B.ttf');
    expect(changes.find((c) => c.isRemoved)?.filename).toBe('A.ttf');
    const modified = changes.find((c) => c.isModified);
    expect(modified?.filename).toBe('D.ttf');
    expect(modified?.oldInfo?.signature).not.toBe(modified?.newInfo?.signature);
  });

  it('creates unchanged entries via the factory', () => {
    const info = {
      path: '/x/A.ttf', filename: 'A.ttf', file_size: 1, file_mtime: 1,
      signature: 'sig', format: 'truetype' as const,
    };
    const change = DirectoryChange.unchanged('A.ttf', info);
    expect(change.isUnchanged).toBe(true);
    expect(change.toObject().new_info?.filename).toBe('A.ttf');
  });
});

describe('IncrementalIndexUpdater', () => {
  it('detects all files as added on first scan and stores the snapshot', async () => {
    const e = await env();
    const store = new FileSnapshotStore(path.join(e.home, 'cache'));
    const updater = new IncrementalIndexUpdater(path.join(e.home, 'fonts'), store);
    const changes = await updater.update();
    expect(updater.addedFiles()).toHaveLength(1);
    expect(changes[0]!.isAdded).toBe(true);
    // Snapshot persisted for subsequent scans.
    const second = new IncrementalIndexUpdater(path.join(e.home, 'fonts'), store);
    expect(await second.update()).toHaveLength(0);
  });

  it('detects newly added, modified, and removed files on later scans', async () => {
    const e = await env();
    const fontsDir = path.join(e.home, 'fonts');
    const store = new FileSnapshotStore(path.join(e.home, 'cache'));
    const updater = new IncrementalIndexUpdater(fontsDir, store);
    await updater.update();

    await fsp.writeFile(path.join(fontsDir, 'New.ttf'), makeTtf({ family: 'New' }));
    await fsp.rm(path.join(fontsDir, 'A.ttf'));
    const secondUpdater = new IncrementalIndexUpdater(fontsDir, store);
    const changes = await secondUpdater.update();
    expect(changes.some((c) => c.isAdded)).toBe(true);
    expect(changes.some((c) => c.isRemoved)).toBe(true);
    expect(secondUpdater.hasChanges()).toBe(true);
    expect(secondUpdater.stats()).toMatchObject({ added: 1, removed: 1 });
    void updater;
  });

  it('handles empty directories', async () => {
    const e = await env();
    await fsp.rm(path.join(e.home, 'fonts', 'A.ttf'));
    const updater = new IncrementalIndexUpdater(path.join(e.home, 'fonts'), new FileSnapshotStore(path.join(e.home, 'cache')));
    expect(await updater.update()).toHaveLength(0);
    expect(updater.hasChanges()).toBe(false);
  });
});
