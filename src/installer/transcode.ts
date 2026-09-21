import { promises as fsp } from 'node:fs';
import { TranscodeLicenseNotAcceptedError, UnsupportedTranscodeError } from '../errors/errors.js';
import { canConvert } from '../formula/formatMatcher.js';
import { detectFormat } from '../fonts/sfnt/magic.js';
import { SfntFont } from '../fonts/sfnt/sfntFont.js';
import { encodeWoff1 } from '../fonts/woff/woff1.js';
import { encodeWoff2 } from '../fonts/woff/woff2.js';
import * as path from 'node:path';

export interface TranscodeOptions {
  /** Directory for converted output (defaults to the source's directory). */
  outputDir?: string;
  keepOriginal?: boolean;
}

export interface Transcoder {
  /** True when this transcoder converts `from` -> `to`. */
  canConvert(from: string, to: string): boolean;
  /** Performs the conversion and returns the converted file path. */
  convert(sourcePath: string, targetFormat: string, options: TranscodeOptions): Promise<string>;
}

/** Desktop→web transcoder: re-packages TTF/OTF tables into WOFF 1.0
 * (per-table zlib) or WOFF2 (null transforms + one brotli stream). */
class WoffTranscoder implements Transcoder {
  canConvert(from: string, to: string): boolean {
    return (from === 'ttf' || from === 'otf') && (to === 'woff' || to === 'woff2');
  }

  async convert(sourcePath: string, targetFormat: string, options: TranscodeOptions): Promise<string> {
    const bytes = await fsp.readFile(sourcePath);
    const detected = detectFormat(bytes);
    if (detected !== 'ttf' && detected !== 'otf') {
      throw new UnsupportedTranscodeError(
        `Only plain TTF/OTF fonts can be transcoded, got ${detected ?? 'unknown'}: ${sourcePath}`,
      );
    }
    const sfnt = new SfntFont(bytes);
    const tables = sfnt.tables().map((table) => ({
      tag: table.tag,
      checksum: sfntChecksum(table.data),
      data: table.data,
    }));
    const output =
      targetFormat === 'woff'
        ? encodeWoff1(tables, sfnt.flavor())
        : encodeWoff2(tables, sfnt.flavor());
    const target = transcodeTargetPath(sourcePath, targetFormat, options);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, output);
    return target;
  }
}

/** SFNT table checksum: sum of big-endian uint32s over the table padded to
 * a 4-byte boundary, mod 2^32. */
function sfntChecksum(data: Buffer): number {
  const padded = Buffer.alloc((data.length + 3) & ~3);
  data.copy(padded);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + padded.readUInt32BE(offset)) >>> 0;
  }
  return sum;
}

/** Registry of format transcoders (OCP: shipping another converter later
 * means registering an implementation here, not touching the installer). */
export class TranscoderRegistry {
  private readonly transcoders: Transcoder[] = [];

  register(transcoder: Transcoder): this {
    this.transcoders.push(transcoder);
    return this;
  }

  find(from: string, to: string): Transcoder | null {
    return this.transcoders.find((t) => t.canConvert(from, to)) ?? null;
  }

  require(from: string, to: string): Transcoder {
    const transcoder = this.find(from, to);
    if (!transcoder) {
      throw new UnsupportedTranscodeError(
        canConvert(from, to)
          ? `Conversion from ${from} to ${to} is not supported by any registered transcoder ` +
              `(collections and dfont files cannot be transcoded).`
          : `Conversion from ${from} to ${to} is not supported (only desktop -> web formats).`,
      );
    }
    return transcoder;
  }
}

export function defaultTranscoderRegistry(): TranscoderRegistry {
  return new TranscoderRegistry().register(new WoffTranscoder());
}

export function checkTranscodeLicense(confirmation: string | null | undefined): void {
  if (confirmation?.toLowerCase() !== 'yes') {
    throw new TranscodeLicenseNotAcceptedError();
  }
}

export function transcodeTargetPath(
  sourcePath: string,
  targetFormat: string,
  options: TranscodeOptions,
): string {
  const dir = options.outputDir ?? path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(dir, `${base}.${targetFormat}`);
}
