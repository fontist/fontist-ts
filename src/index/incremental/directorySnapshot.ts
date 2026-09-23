import type { ScannedFontFile } from './incrementalScanner.js';
import { IncrementalScanner } from './incrementalScanner.js';

export interface DirectorySnapshotData {
  directory_path: string;
  files: ScannedFontFile[];
  scanned_at: number;
}

/** Immutable directory state at a point in time (Ruby DirectorySnapshot). */
export class DirectorySnapshot {
  private readonly filesByFilename: Map<string, ScannedFontFile>;

  private constructor(
    readonly directoryPath: string,
    readonly files: readonly ScannedFontFile[],
    readonly scannedAt: number,
  ) {
    this.filesByFilename = new Map(files.map((f) => [f.filename, f]));
  }

  static async create(directoryPath: string): Promise<DirectorySnapshot> {
    const files = await IncrementalScanner.scanDirectory(directoryPath);
    return new DirectorySnapshot(directoryPath, files, Math.floor(Date.now() / 1000));
  }

  static fromData(hash: DirectorySnapshotData): DirectorySnapshot {
    return DirectorySnapshot.fromHash(hash);
  }

  static fromHash(hash: DirectorySnapshotData): DirectorySnapshot {
    return new DirectorySnapshot(String(hash.directory_path), hash.files ?? [], hash.scanned_at);
  }

  fileInfo(filename: string): ScannedFontFile | null {
    return this.filesByFilename.get(filename) ?? null;
  }

  hasFile(filename: string): boolean {
    return this.filesByFilename.has(filename);
  }

  olderThan(seconds: number): boolean {
    return Math.floor(Date.now() / 1000) - this.scannedAt > seconds;
  }

  get fileCount(): number {
    return this.files.length;
  }

  toObject(): DirectorySnapshotData {
    return {
      directory_path: this.directoryPath,
      files: [...this.files],
      scanned_at: this.scannedAt,
    };
  }
}
