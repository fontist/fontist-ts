/** Ruby Windows#normalize_key: lowercase, non-alphanumerics collapsed to
 * underscores, trimmed. */
export function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
