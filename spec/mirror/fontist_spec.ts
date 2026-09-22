// Mirrors spec/fontist/fontist_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FONTIST_VERSION } from '../../src/context.js';

describe('Fontist (module attributes)', () => {
  it('reports a semantic version', () => {
    expect(FONTIST_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes formulas_version v5', async () => {
    const { FORMULAS_VERSION } = await import('../../src/paths.js');
    expect(FORMULAS_VERSION).toBe('v5');
  });

  it('exposes the formulas repository URL', async () => {
    const { FORMULAS_REPO_URL } = await import('../../src/paths.js');
    expect(FORMULAS_REPO_URL).toContain('github.com/fontist/formulas');
  });
});
