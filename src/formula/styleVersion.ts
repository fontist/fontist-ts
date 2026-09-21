/** Font style version comparison, mirroring Ruby's StyleVersion: the text up
 * to the first `;` is split on `.` and the string segments are compared. */
export class StyleVersion {
  private readonly value: string[];

  constructor(text: string | null | undefined) {
    const stringVersion = text?.split(';')[0] ?? null;
    this.value = stringVersion?.split('.').map((part) => part.trim()) ?? ['0'];
  }

  toString(): string {
    return this.value.join(' . ');
  }

  compare(other: StyleVersion): number {
    const length = Math.max(this.value.length, other.value.length);
    for (let i = 0; i < length; i++) {
      const a = this.value[i] ?? '0';
      const b = other.value[i] ?? '0';
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  equals(other: StyleVersion): boolean {
    return this.compare(other) === 0;
  }

  static max(versions: StyleVersion[]): StyleVersion | null {
    if (versions.length === 0) return null;
    return versions.reduce((max, current) => (current.compare(max) > 0 ? current : max));
  }
}
