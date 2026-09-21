import { createWriteStream } from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { FontExtractError } from '../errors/errors.js';
import { safeEntryName, type Extractor } from './extractor.js';

const openZip = promisify(yauzl.open) as (
  path: string,
  options: yauzl.Options,
) => Promise<yauzl.ZipFile>;

/** Zip extractor on yauzl (streaming, no native dependencies). */
export class ZipExtractor implements Extractor {
  readonly formatId = 'zip';

  detect(bytes: Uint8Array): boolean {
    return (
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06)
    );
  }

  async extract(archivePath: string, destDir: string): Promise<string[]> {
    const zip = await openZip(archivePath, { lazyEntries: true, autoClose: true });
    const extracted: string[] = [];
    try {
      for (;;) {
        const entry = await nextEntry(zip);
        if (entry === null) break;
        if (entry.fileName.endsWith('/')) continue;
        const target = path.join(destDir, safeEntryName(entry.fileName));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await writeEntry(zip, entry, target);
        extracted.push(target);
      }
    } finally {
      zip.close();
    }
    return extracted;
  }
}

function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    zip.once('entry', (entry) => resolve(entry));
    zip.once('end', () => resolve(null));
    zip.once('error', (err) => reject(new FontExtractError(String(err))));
    zip.readEntry();
  });
}

function writeEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new FontExtractError(`Zip entry could not be read: ${entry.fileName}`));
        return;
      }
      const out = createWriteStream(target);
      out.on('finish', () => resolve());
      out.on('error', (writeErr: Error) => reject(new FontExtractError(String(writeErr))));
      stream.on('error', (readErr: Error) => reject(new FontExtractError(String(readErr))));
      stream.pipe(out);
    });
  });
}
