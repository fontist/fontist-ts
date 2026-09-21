import { CollectionIndexError } from '../../errors/errors.js';
import { SfntFont } from './sfntFont.js';

const TTC_HEADER_SIZE = 12;

/** Reader over a `ttcf` collection, resolving faces by index. */
export class SfntCollection {
  private faceOffsets: number[] = [];

  constructor(data: Uint8Array) {
    if (data.length < TTC_HEADER_SIZE) {
      throw new CollectionIndexError('Font collection header is truncated');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numFonts = view.getUint32(8);
    if (TTC_HEADER_SIZE + numFonts * 4 > data.length) {
      throw new CollectionIndexError('Font collection declares more faces than it contains');
    }
    for (let i = 0; i < numFonts; i++) {
      this.faceOffsets.push(view.getUint32(TTC_HEADER_SIZE + i * 4));
    }
    this.data = data;
  }

  private readonly data: Uint8Array;

  faceCount(): number {
    return this.faceOffsets.length;
  }

  face(index: number): SfntFont {
    const offset = this.faceOffsets[index];
    if (offset === undefined || offset >= this.data.length) {
      throw new CollectionIndexError(`Font collection face index out of range: ${index}`);
    }
    return new SfntFont(this.data.subarray(offset));
  }
}
