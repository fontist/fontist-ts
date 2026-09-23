import { FontFileError } from '../../errors/errors.js';
import { NAME_ID, englishName, parseNameTable, type NameRecord } from './nameTable.js';

export interface VariableAxis {
  tag: string;
  minValue: number;
  defaultValue: number;
  maxValue: number;
}

/** Reader over one SFNT face (a standalone font, or one face of a TTC). */
export class SfntFont {
  private data: Uint8Array;
  private view: DataView;
  private tableCache: Map<string, { offset: number; length: number }> | null = null;
  private names: NameRecord[] | null = null;
  private axes: VariableAxis[] | null = null;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  /** The SFNT version tag: `\x00\x01\x00\x00`/`true` for TrueType, `OTTO` for CFF. */
  sfntVersionTag(): string {
    if (this.data.length < 4) return '';
    return String.fromCharCode(this.data[0]!, this.data[1]!, this.data[2]!, this.data[3]!);
  }

  private tableEntries(): Map<string, { offset: number; length: number }> {
    if (this.tableCache) return this.tableCache;
    const tables = new Map<string, { offset: number; length: number }>();
    if (this.data.length < 12) {
      this.tableCache = tables;
      return tables;
    }
    const numTables = this.view.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const recordOffset = 12 + i * 16;
      if (recordOffset + 16 > this.data.length) break;
      const tag = String.fromCharCode(
        this.data[recordOffset]!,
        this.data[recordOffset + 1]!,
        this.data[recordOffset + 2]!,
        this.data[recordOffset + 3]!,
      );
      const offset = this.view.getUint32(recordOffset + 8);
      const length = this.view.getUint32(recordOffset + 12);
      if (offset + length <= this.data.length) {
        tables.set(tag, { offset, length });
      }
    }
    this.tableCache = tables;
    return tables;
  }

  private table(tag: string): Uint8Array | null {
    const entry = this.tableEntries().get(tag);
    if (!entry) return null;
    return this.data.subarray(entry.offset, entry.offset + entry.length);
  }

  private namesFromTable(): NameRecord[] {
    if (this.names) return this.names;
    const nameTableData = this.table('name');
    this.names = nameTableData ? parseNameTable(nameTableData) : [];
    return this.names;
  }

  name(id: number): string | null {
    return englishName(this.namesFromTable(), id);
  }

  familyName(): string | null {
    return this.name(NAME_ID.FAMILY);
  }

  subfamilyName(): string | null {
    return this.name(NAME_ID.SUBFAMILY);
  }

  fullName(): string | null {
    return this.name(NAME_ID.FULL_NAME);
  }

  postScriptName(): string | null {
    return this.name(NAME_ID.POSTSCRIPT_NAME);
  }

  preferredFamilyName(): string | null {
    return this.name(NAME_ID.PREFERRED_FAMILY);
  }

  preferredSubfamilyName(): string | null {
    return this.name(NAME_ID.PREFERRED_SUBFAMILY);
  }

  version(): string | null {
    return this.name(NAME_ID.VERSION);
  }

  copyright(): string | null {
    return this.name(NAME_ID.COPYRIGHT);
  }

  vendorUrl(): string | null {
    return this.name(NAME_ID.VENDOR_URL);
  }

  licenseDescription(): string | null {
    return this.name(NAME_ID.LICENSE_DESCRIPTION);
  }

  licenseUrl(): string | null {
    return this.name(NAME_ID.LICENSE_URL);
  }

  /** An SFNT font is variable when it carries an fvar table. */
  isVariable(): boolean {
    return this.table('fvar') !== null;
  }

  variableAxes(): VariableAxis[] {
    if (this.axes) return this.axes;
    this.axes = [];
    const fvar = this.table('fvar');
    if (!fvar || fvar.length < 16) return this.axes;
    const view = new DataView(fvar.buffer, fvar.byteOffset, fvar.byteLength);
    const axisCount = view.getUint16(8);
    const axisSize = view.getUint16(10) || 20;
    const axesOffset = view.getUint16(4);
    for (let i = 0; i < axisCount; i++) {
      const base = axesOffset + i * axisSize;
      if (base + 20 > fvar.length) break;
      const tag = String.fromCharCode(
        fvar[base]!,
        fvar[base + 1]!,
        fvar[base + 2]!,
        fvar[base + 3]!,
      );
      this.axes.push({
        tag,
        minValue: fixed(view.getInt32(base + 4)),
        defaultValue: fixed(view.getInt32(base + 8)),
        maxValue: fixed(view.getInt32(base + 12)),
      });
    }
    return this.axes;
  }

  /** Raw table bodies in directory order (for encoders and re-packers). */
  tables(): { tag: string; data: Buffer }[] {
    return Array.from(this.tableEntries().entries()).map(([tag, entry]) => ({
      tag,
      data: Buffer.from(this.data.subarray(entry.offset, entry.offset + entry.length)),
    }));
  }

  /** The sfnt version tag (0x00010000 for TrueType, 'OTTO' for CFF). */
  flavor(): number {
    return this.view.getUint32(0);
  }

  /** Validates that the binary is a readable font with at least a family name. */
  validate(): void {
    if (this.tableEntries().size === 0) {
      throw new FontFileError('Font has no readable table directory');
    }
  }
}

function fixed(value: number): number {
  return value / 65536;
}
