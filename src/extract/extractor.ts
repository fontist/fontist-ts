import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { UnknownArchiveError } from '../errors/errors.js';

export interface ArchiveFormat {
  /** Human-readable identifier used in errors and logs. */
  id: string;
  /** Returns true when the leading bytes identify this format. */
  detect(bytes: Uint8Array): boolean;
}

export interface Extractor {
  readonly formatId: string;
  detect(bytes: Uint8Array): boolean;
  /** Extracts to `destDir` and returns the paths of all extracted files. */
  extract(archivePath: string, destDir: string): Promise<string[]>;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export const FORMATS: readonly ArchiveFormat[] = [
  { id: 'zip', detect: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]) },
  { id: 'gzip', detect: (b) => startsWith(b, [0x1f, 0x8b]) },
  { id: 'tar', detect: (b) => asciiAt(b, 257, 'ustar') },
  { id: '7z', detect: (b) => startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { id: 'cab', detect: (b) => asciiAt(b, 0, 'MSCF') },
  { id: 'msi', detect: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]) },
  { id: 'rpm', detect: (b) => startsWith(b, [0xed, 0xab, 0xee, 0xdb]) },
  { id: 'xz', detect: (b) => startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) },
  { id: 'bzip2', detect: (b) => asciiAt(b, 0, 'BZh') },
];

export function detectArchiveFormat(bytes: Uint8Array): ArchiveFormat | null {
  return FORMATS.find((format) => format.detect(bytes)) ?? null;
}

/** Registry of archive extractors (OCP: formats register themselves; the
 * extraction pipeline never changes when a format is added). */
export class ExtractorRegistry {
  private readonly extractors: Extractor[] = [];

  register(extractor: Extractor): this {
    this.extractors.push(extractor);
    return this;
  }

  find(bytes: Uint8Array): Extractor | null {
    return this.extractors.find((extractor) => extractor.detect(bytes)) ?? null;
  }

  findForFile(filePath: string): Promise<Extractor | null> {
    return fsp.open(filePath, 'r').then(async (handle) => {
      try {
        const buffer = Buffer.alloc(512);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return this.find(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    });
  }

  /** Finds an extractor or throws a descriptive UnknownArchiveError. */
  async requireForFile(filePath: string): Promise<Extractor> {
    const handle = await fsp.open(filePath, 'r');
    let bytes: Uint8Array;
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const extractor = this.find(bytes);
    if (extractor) return extractor;
    const format = detectArchiveFormat(bytes);
    throw new UnknownArchiveError(
      format
        ? `No extractor registered for archive format "${format.id}": ${filePath}`
        : `Unknown archive format: ${filePath}`,
    );
  }
}

/** Rejects entries that would escape the destination directory. */
export function safeEntryName(entryName: string): string {
  const normalized = path.normalize(entryName).replace(/^(\.\.(\/|\\|$))+/, '');
  if (path.isAbsolute(entryName) || normalized.startsWith('..')) {
    throw new UnknownArchiveError(`Refusing unsafe archive entry: ${entryName}`);
  }
  return normalized;
}
