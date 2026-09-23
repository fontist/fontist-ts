import type { DirectorySnapshot } from './directorySnapshot.js';
import type { ScannedFontFile } from './incrementalScanner.js';

export type ChangeType = 'added' | 'modified' | 'removed' | 'unchanged';

export interface DirectoryChangeData {
  change_type: ChangeType;
  filename: string;
  old_info: ScannedFontFile | null;
  new_info: ScannedFontFile | null;
}

/** A single change between two directory snapshots (Ruby DirectoryChange). */
export class DirectoryChange {
  private constructor(private readonly data: DirectoryChangeData) {}

  static added(filename: string, newInfo: ScannedFontFile): DirectoryChange {
    return new DirectoryChange({ change_type: 'added', filename, old_info: null, new_info: newInfo });
  }

  static modified(filename: string, oldInfo: ScannedFontFile, newInfo: ScannedFontFile): DirectoryChange {
    return new DirectoryChange({ change_type: 'modified', filename, old_info: oldInfo, new_info: newInfo });
  }

  static removed(filename: string, oldInfo: ScannedFontFile): DirectoryChange {
    return new DirectoryChange({ change_type: 'removed', filename, old_info: oldInfo, new_info: null });
  }

  static unchanged(filename: string, info: ScannedFontFile): DirectoryChange {
    return new DirectoryChange({ change_type: 'unchanged', filename, old_info: info, new_info: info });
  }

  /** Diffs two snapshots into the list of changes. */
  static diff(oldSnapshot: DirectorySnapshot, newSnapshot: DirectorySnapshot): DirectoryChange[] {
    const changes: DirectoryChange[] = [];
    for (const newFile of newSnapshot.files) {
      const oldFile = oldSnapshot.fileInfo(newFile.filename);
      if (oldFile === null) {
        changes.push(DirectoryChange.added(newFile.filename, newFile));
      } else if (fileModified(oldFile, newFile)) {
        changes.push(DirectoryChange.modified(newFile.filename, oldFile, newFile));
      }
    }
    for (const oldFile of oldSnapshot.files) {
      if (!newSnapshot.hasFile(oldFile.filename)) {
        changes.push(DirectoryChange.removed(oldFile.filename, oldFile));
      }
    }
    return changes;
  }

  get isAdded(): boolean {
    return this.data.change_type === 'added';
  }
  get isModified(): boolean {
    return this.data.change_type === 'modified';
  }
  get isRemoved(): boolean {
    return this.data.change_type === 'removed';
  }
  get isUnchanged(): boolean {
    return this.data.change_type === 'unchanged';
  }
  get filename(): string {
    return this.data.filename;
  }
  get oldInfo(): ScannedFontFile | null {
    return this.data.old_info;
  }
  get newInfo(): ScannedFontFile | null {
    return this.data.new_info;
  }

  toObject(): DirectoryChangeData {
    return { ...this.data };
  }
}

function fileModified(oldFile: ScannedFontFile, newFile: ScannedFontFile): boolean {
  return (
    oldFile.file_size !== newFile.file_size ||
    oldFile.file_mtime !== newFile.file_mtime ||
    oldFile.signature !== newFile.signature
  );
}
