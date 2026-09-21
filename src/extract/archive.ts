import { promises as fsp } from 'node:fs';
import { FontExtractError } from '../errors/errors.js';
import { ExtractorRegistry } from './extractor.js';
import { TarExtractor } from './tarExtractor.js';
import { ZipExtractor } from './zipExtractor.js';

export interface ArchiveOptions {
  /** When true, extracted files that are themselves supported archives are
   * extracted recursively (Ruby excavate's `recursive_packages`). */
  recursivePackages?: boolean;
}

/** Facade performing (recursive) archive extraction. */
export class Archive {
  private readonly registry: ExtractorRegistry;

  constructor(registry: ExtractorRegistry | null = null) {
    this.registry = registry ?? defaultRegistry();
  }

  /** Extracts `archivePath` into `destDir`; returns all extracted file paths. */
  async extractAll(archivePath: string, destDir: string, options: ArchiveOptions = {}): Promise<string[]> {
    const extractor = await this.registry.requireForFile(archivePath);
    await fsp.mkdir(destDir, { recursive: true });
    let extracted: string[];
    try {
      extracted = await extractor.extract(archivePath, destDir);
    } catch (err) {
      if (err instanceof FontExtractError) throw err;
      throw new FontExtractError(`Extraction failed for ${archivePath}: ${String(err)}`);
    }

    if (options.recursivePackages ?? true) {
      extracted = await this.extractNested(extracted, options);
    }
    return extracted;
  }

  private async extractNested(files: string[], options: ArchiveOptions): Promise<string[]> {
    const result: string[] = [];
    for (const file of files) {
      const bytes = await readLeadingBytes(file);
      if (bytes === null) {
        result.push(file);
        continue;
      }
      if (this.registry.find(bytes) !== null) {
        const nestedDir = `${file}-extracted`;
        const nested = await this.extractAll(file, nestedDir, options);
        await fsp.rm(file, { force: true });
        result.push(...nested);
      } else {
        result.push(file);
      }
    }
    return result;
  }
}

async function readLeadingBytes(filePath: string): Promise<Uint8Array | null> {
  try {
    const handle = await fsp.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) return null;
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export function defaultRegistry(): ExtractorRegistry {
  return new ExtractorRegistry().register(new ZipExtractor()).register(new TarExtractor());
}
