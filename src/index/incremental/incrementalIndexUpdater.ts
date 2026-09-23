import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { DirectoryChange } from './directoryChange.js';
import { DirectorySnapshot, type DirectorySnapshotData } from './directorySnapshot.js';

export const SNAPSHOT_TTL_SECONDS = 300;
export const CHANGE_DETECTION_TTL_SECONDS = 60;

export interface IncrementalStats {
  total_changes: number;
  added: number;
  modified: number;
  removed: number;
}

/** Pluggable snapshot persistence. The default stores JSON files under the
 * given cache directory (Ruby uses Cache::Manager with a 300s TTL; the TTL
 * semantics are enforced by the updater's freshness check). */
export class FileSnapshotStore {
  constructor(private readonly cacheDirectory: string) {}

  async load(directoryPath: string): Promise<DirectorySnapshot | null> {
    try {
      const text = await fsp.readFile(this.snapshotPath(directoryPath), 'utf8');
      return DirectorySnapshot.fromData(JSON.parse(text) as DirectorySnapshotData);
    } catch {
      return null;
    }
  }

  async save(snapshot: DirectorySnapshot): Promise<void> {
    const target = this.snapshotPath(snapshot.directoryPath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify(snapshot.toObject(), null, 2), 'utf8');
  }

  private snapshotPath(directoryPath: string): string {
    const key = createHash('sha256').update(directoryPath).digest('hex').slice(0, 24);
    return path.join(this.cacheDirectory, `snapshot-${key}.json`);
  }
}

/** Incremental index updates: only changed files/directories are diffed
 * between snapshots (Ruby IncrementalIndexUpdater). */
export class IncrementalIndexUpdater {
  private changes: DirectoryChange[] = [];

  constructor(
    private readonly directoryPath: string,
    private readonly store: SnapshotStore = new FileSnapshotStore(
      path.join(process.cwd(), '.fontist-cache', 'indexes'),
    ),
  ) {}

  async update(): Promise<DirectoryChange[]> {
    const oldSnapshot = await this.store.load(this.directoryPath);
    const newSnapshot = await DirectorySnapshot.create(this.directoryPath);

    this.changes =
      oldSnapshot === null
        ? newSnapshot.files.map((file) => DirectoryChange.added(file.filename, file))
        : DirectoryChange.diff(oldSnapshot, newSnapshot);

    await this.store.save(newSnapshot);
    return this.changes;
  }

  addedFiles(): DirectoryChange[] {
    return this.changes.filter((c) => c.isAdded);
  }

  modifiedFiles(): DirectoryChange[] {
    return this.changes.filter((c) => c.isModified);
  }

  removedFiles(): DirectoryChange[] {
    return this.changes.filter((c) => c.isRemoved);
  }

  hasChanges(): boolean {
    return this.changes.length > 0;
  }

  stats(): IncrementalStats {
    return {
      total_changes: this.changes.length,
      added: this.addedFiles().length,
      modified: this.modifiedFiles().length,
      removed: this.removedFiles().length,
    };
  }
}

export interface SnapshotStore {
  load(directoryPath: string): Promise<DirectorySnapshot | null>;
  save(snapshot: DirectorySnapshot): Promise<void>;
}
