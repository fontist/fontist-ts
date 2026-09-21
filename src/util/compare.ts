/** Compares dotted version strings the way Ruby's Gem::Version does:
 * numeric segment comparison, shorter padded with zeros. */
export function compareVersions(a: string, b: string): number {
  const as = versionSegments(a);
  const bs = versionSegments(b);
  const length = Math.max(as.length, bs.length);
  for (let i = 0; i < length; i++) {
    const av = as[i] ?? 0;
    const bv = bs[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function versionSegments(version: string): number[] {
  return version
    .split('.')
    .map((part) => {
      const match = part.match(/\d+/);
      return match ? Number.parseInt(match[0] ?? '0', 10) : 0;
    });
}

export function equalsIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Ruby File.fnmatch-style match restricted to the patterns Fontist builds:
 * a literal prefix followed by `*` and a literal suffix (used for fonts_sub_dir). */
export function fnmatchSuffix(pattern: string, value: string): boolean {
  const starIndex = pattern.indexOf('*');
  if (starIndex === -1) return pattern === value;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  return (
    value.startsWith(prefix) &&
    value.length >= prefix.length + suffix.length &&
    value.endsWith(suffix)
  );
}
