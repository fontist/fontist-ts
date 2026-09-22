import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONTIST_VERSION } from '../src/context.js';

describe('FONTIST_VERSION', () => {
  it('always matches the package.json version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(FONTIST_VERSION).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
