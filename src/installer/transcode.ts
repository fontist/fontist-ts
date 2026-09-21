import * as path from 'node:path';
import { TranscodeLicenseNotAcceptedError, UnsupportedTranscodeError } from '../errors/errors.js';
import { canConvert } from '../formula/formatMatcher.js';

export interface TranscodeOptions {
  /** Directory for converted output (defaults to a temp dir chosen by caller). */
  outputDir?: string;
  keepOriginal?: boolean;
}

export interface Transcoder {
  /** True when this transcoder converts `from` -> `to`. */
  canConvert(from: string, to: string): boolean;
  /** Performs the conversion and returns the converted file path. */
  convert(sourcePath: string, targetFormat: string, options: TranscodeOptions): Promise<string>;
}

/** Registry of format transcoders (OCP: shipping a web-format transcoder
 * later means registering an implementation here, not touching the installer). */
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
          ? `Conversion from ${from} to ${to} is planned but no transcoder is registered yet ` +
              '(see TODO.impl/22-transcode.md).'
          : `Conversion from ${from} to ${to} is not supported (only desktop -> web formats).`,
      );
    }
    return transcoder;
  }
}

export function defaultTranscoderRegistry(): TranscoderRegistry {
  return new TranscoderRegistry();
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
