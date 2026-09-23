import { promises as fsp } from 'node:fs';
import { UnknownFontTypeError } from '../../errors/errors.js';
import type { FontParsingErrorCollector } from '../fontParsingErrorCollector.js';

export type DetectedFontKind = 'font' | 'collection' | 'other';

/** Platform-specific font containers preserved as-is (Ruby: dfont, otc). */
export const PLATFORM_SPECIFIC_EXTENSIONS = ['dfont', 'otc'] as const;

const HEADER_SIZE = 8;

async function sniff(path: string): Promise<string | null> {
  const handle = await fsp.open(path, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_SIZE, 0);
    if (bytesRead < 4) return null;
    return buffer.toString('latin1', 0, Math.max(4, bytesRead));
  } finally {
    await handle.close();
  }
}

function kindFromMagic(bytes: Buffer): DetectedFontKind {
  const tag = bytes.toString('latin1', 0, 4);
  switch (tag) {
    case '\x00\x01\x00\x00':
    case 'true':
    case 'OTTO':
    case 'wOFF':
    case 'wOF2':
      return 'font';
    case 'ttcf':
      return 'collection';
    default: {
      // Classic Mac resource fork header (dfont): data section at byte 256
      if (bytes.readUInt32BE(0) === 0x00000100) {
        return 'collection';
      }
      return 'other';
    }
  }
}

/** Detects whether a path holds a single font, a collection, or something
 * else (Ruby Files::FontDetector). */
export class FontDetector {
  static async detect(path: string, errorCollector?: FontParsingErrorCollector): Promise<DetectedFontKind> {
    try {
      const header = await sniff(path);
      if (!header) return 'other';
      return kindFromMagic(Buffer.from(header, 'latin1'));
    } catch (err) {
      errorCollector?.add(path, err instanceof Error ? err.message : String(err));
      return 'other';
    }
  }

  /** Standard extension for the detected format, preserving platform
   * container extensions (dfont, otc). */
  static async standardExtension(path: string, errorCollector?: FontParsingErrorCollector): Promise<string | null> {
    const fileExt = extnameOf(path);
    if (PLATFORM_SPECIFIC_EXTENSIONS.includes(fileExt as (typeof PLATFORM_SPECIFIC_EXTENSIONS)[number])) {
      return fileExt;
    }

    try {
      const header = await sniff(path);
      if (!header) {
        throw new UnknownFontTypeError(`Cannot detect font type: ${path}`);
      }
      const kind = kindFromMagic(Buffer.from(header, 'latin1'));
      if (kind === 'collection') return 'ttc';

      const tag = header.slice(0, 4);
      if (tag === 'OTTO') return 'otf';
      if (tag === '\x00\x01\x00\x00' || tag === 'true') return 'ttf';
      if (kind === 'font') return fileExt;
      throw new UnknownFontTypeError(`Cannot detect font type: ${path}`);
    } catch (err) {
      errorCollector?.add(path, err instanceof Error ? err.message : String(err));
      throw err instanceof UnknownFontTypeError
        ? err
        : new UnknownFontTypeError(`Cannot detect font type: ${path}`);
    }
  }
}

function extnameOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}
