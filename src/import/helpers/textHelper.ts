/** Ruby Fontist::Import::TextHelper. */
export class TextHelper {
  static cleanup(text: string | null | undefined): string | null {
    if (!text) return null;
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n');
  }

  /** Longest common prefix of all strings; requires >= 2 characters. */
  static longestCommonPrefix(strs: string[]): string | null {
    if (strs.length === 0) return null;
    let min = strs[0]!;
    let max = strs[0]!;
    for (const s of strs) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
    let idx = 0;
    while (idx < min.length && min[idx] === max[idx]) idx++;
    const prefix = min.slice(0, idx).trim();
    return prefix.length < 2 ? null : prefix;
  }
}
