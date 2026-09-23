import { promises as fsp } from 'node:fs';
import { looksLikeDfont } from './dfont.js';

export type FontBinaryFormat = 'ttf' | 'otf' | 'ttc' | 'otc' | 'woff' | 'woff2' | 'dfont';

/** Sniffs the font binary format from magic bytes, independent of the extension. */
export function detectFormat(bytes: Uint8Array): FontBinaryFormat | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  switch (tag) {
    case '\x00\x01\x00\x00':
    case 'true':
      return 'ttf';
    case 'OTTO':
      return 'otf';
    case 'ttcf':
      // Collections of CFF-based fonts are commonly called OTC, but the
      // container itself is identical; callers disambiguate via extension.
      return 'ttc';
    case 'wOFF':
      return 'woff';
    case 'wOF2':
      return 'woff2';
    default:
      return looksLikeDfont(bytes) ? 'dfont' : null;
  }
}

export async function detectFormatFromFile(filePath: string): Promise<FontBinaryFormat | null> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead < 4) return null;
    return detectFormat(buffer);
  } finally {
    await handle.close();
  }
}
