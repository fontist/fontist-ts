import { promises as fsp } from 'node:fs';
import * as yaml from 'yaml';
import { atomicWriteFile } from '../../util/fsx.js';

export type IndexEntries = Map<string, string[]>;

/** Reads/writes the YAML index file shape shared by all formula indexes:
 * `key -> [relative formula paths]`. */
export async function loadIndexEntries(indexPath: string): Promise<IndexEntries | null> {
  let text: string;
  try {
    text = await fsp.readFile(indexPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = yaml.parse(text);
  if (parsed === null || parsed === undefined) return new Map();
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries: IndexEntries = new Map();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const paths = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    entries.set(key, paths);
  }
  return entries;
}

export async function saveIndexEntries(indexPath: string, entries: IndexEntries): Promise<void> {
  const object: Record<string, string[]> = {};
  for (const key of Array.from(entries.keys()).sort()) {
    object[key] = entries.get(key)!;
  }
  await atomicWriteFile(indexPath, yaml.stringify(object, { lineWidth: 0 }));
}
