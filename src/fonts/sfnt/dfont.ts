import { FontFileError } from '../../errors/errors.js';
import { SfntFont } from './sfntFont.js';

/** Mac resource-fork container (`.dfont`): SFNT fonts are stored as
 * resources of type `sfnt`. Ruby reads these through Fontisan's
 * FontLoader; this minimal reader extracts the same faces. */
export class DfontCollection {
  private readonly view: DataView;
  private readonly dataBase: number;
  private readonly sfntRelOffsets: number[] = [];

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length < 28) {
      throw new FontFileError('dfont file is too small');
    }
    this.dataBase = this.view.getUint32(0);
    const mapOffset = this.view.getUint32(4);
    const dataLength = this.view.getUint32(8);
    const mapLength = this.view.getUint32(12);
    if (this.dataBase + dataLength > data.length || mapOffset + mapLength > data.length) {
      throw new FontFileError('dfont resource offsets out of bounds');
    }

    const typeListOffset = this.view.getUint16(mapOffset + 24);
    const typeList = mapOffset + typeListOffset;
    const numTypes = this.view.getUint16(typeList) + 1;
    for (let i = 0; i < numTypes; i++) {
      const entry = typeList + 2 + i * 8;
      const tag = String.fromCharCode(
        data[entry]!,
        data[entry + 1]!,
        data[entry + 2]!,
        data[entry + 3]!,
      );
      if (tag !== 'sfnt') continue;
      const refCount = this.view.getUint16(entry + 4) + 1;
      const refList = typeList + this.view.getUint16(entry + 6);
      for (let r = 0; r < refCount; r++) {
        const ref = refList + r * 12;
        this.sfntRelOffsets.push(this.view.getUint32(ref + 4));
      }
      break;
    }
  }

  get faceCount(): number {
    return this.sfntRelOffsets.length;
  }

  face(index: number): SfntFont {
    const relOffset = this.sfntRelOffsets[index];
    if (relOffset === undefined) {
      throw new FontFileError(`dfont has no face at index ${index}`);
    }
    const offset = this.dataBase + relOffset;
    const length = this.view.getUint32(offset);
    const face = this.data.subarray(offset + 4, offset + 4 + length);
    return new SfntFont(face);
  }
}

/** Matches the classic resource-fork header: the data section starts at
 * byte 256 (0x00000100 big-endian), distinguishing dfonts from TTFs
 * (0x00010000). */
export function looksLikeDfont(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0) === 0x00000100;
}
