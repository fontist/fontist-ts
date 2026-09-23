/** Ruby Fontist::Import::Helpers::HashHelper — stringifies object keys the
 * same way `JSON.parse(hash.to_json)` does (drops undefined values). */
export function stringifyKeys<T>(value: T): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
