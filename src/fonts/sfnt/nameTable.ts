/** name-table record identifiers Fontist relies on. */
export const NAME_ID = {
  COPYRIGHT: 0,
  FAMILY: 1,
  SUBFAMILY: 2,
  FULL_NAME: 4,
  VERSION: 5,
  POSTSCRIPT_NAME: 6,
  DESCRIPTION: 10,
  VENDOR_URL: 11,
  LICENSE_DESCRIPTION: 13,
  LICENSE_URL: 14,
  PREFERRED_FAMILY: 16,
  PREFERRED_SUBFAMILY: 17,
} as const;

export interface NameRecord {
  platformId: number;
  encodingId: number;
  languageId: number;
  nameId: number;
  value: string;
}

const MAC_ROMAN = 'macintosh';

function decodeString(bytes: Uint8Array, platformId: number, encodingId: number): string | null {
  try {
    if (platformId === 0 || platformId === 3) {
      // Unicode and Windows strings are UTF-16BE (Windows symbol fonts too).
      return new TextDecoder('utf-16be').decode(bytes);
    }
    if (platformId === 1 && encodingId === 0) {
      return new TextDecoder(MAC_ROMAN).decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

export function parseNameTable(data: Uint8Array): NameRecord[] {
  if (data.length < 6) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const format = view.getUint16(0);
  if (format !== 0) return [];
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const recordOffset = 6 + i * 12;
    if (recordOffset + 12 > data.length) break;
    const platformId = view.getUint16(recordOffset);
    const encodingId = view.getUint16(recordOffset + 2);
    const languageId = view.getUint16(recordOffset + 4);
    const nameId = view.getUint16(recordOffset + 6);
    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const start = stringOffset + offset;
    if (start + length > data.length) continue;
    const value = decodeString(data.subarray(start, start + length), platformId, encodingId);
    if (value !== null && value.length > 0) {
      records.push({ platformId, encodingId, languageId, nameId, value });
    }
  }
  return records;
}

function isEnglish(record: NameRecord): boolean {
  if (record.platformId === 3) {
    return record.languageId === 0x0409 || record.languageId === 0x0809;
  }
  if (record.platformId === 0) return record.languageId === 0;
  return false;
}

/** Resolves the best English name for an id, preferring Windows en-US, then
 * any English, then any language — mirroring fontisan's resolution order. */
export function englishName(records: NameRecord[], nameId: number): string | null {
  const candidates = records.filter((r) => r.nameId === nameId);
  if (candidates.length === 0) return null;
  const windowsEnglish = candidates.find(
    (r) => r.platformId === 3 && r.languageId === 0x0409,
  );
  if (windowsEnglish) return windowsEnglish.value;
  const english = candidates.find((r) => isEnglish(r));
  if (english) return english.value;
  return candidates[0]!.value;
}
