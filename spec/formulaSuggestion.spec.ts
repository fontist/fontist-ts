import { describe, expect, it } from 'vitest';
import { FormulaSuggestion } from '../src/formula/formulaSuggestion.js';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import { cleanup, testEnv, writeFormula, type TestEnv } from './helpers/index.js';

const envs: TestEnv[] = [];

async function envWithFormulas(): Promise<TestEnv> {
  const env = await testEnv();
  envs.push(env);
  await writeFormula(env, 'overpass', {
    name: 'Overpass',
    fonts: [{ name: 'Overpass', styles: [{ family_name: 'Overpass', type: 'Regular', font: 'Overpass-Regular.ttf' }] }],
    resources: { 'o.zip': { urls: ['https://example.com/o.zip'] } },
  });
  await writeFormula(env, 'macos/overpass_mono', {
    name: 'Overpass Mono',
    fonts: [{ name: 'Overpass Mono', styles: [{ family_name: 'Overpass Mono', type: 'Regular', font: 'OverpassMono.ttf' }] }],
    resources: { 'om.zip': { urls: ['https://example.com/om.zip'] } },
  });
  // A manual (non-downloadable) formula: suggestions must exclude it.
  await writeFormula(env, 'manual_thing', {
    name: 'Manual Thing',
    fonts: [{ name: 'Manual Thing', styles: [{ family_name: 'Manual Thing', type: 'Regular', font: 'MT.ttf' }] }],
  });
  return env;
}

describe('FormulaSuggestion', () => {
  it('ranks near-miss names above unrelated ones and keeps downloadable only', async () => {
    const env = await envWithFormulas();
    try {
      const repository = new FormulaRepository(env.ctx);
      const suggestions = await new FormulaSuggestion(repository).find('overpasss');
      expect(suggestions).toContain('overpass');
      expect(suggestions).not.toContain('manual_thing');
      expect(suggestions[0]).toBe('overpass');
    } finally {
      await cleanup(env);
    }
  });

  it('ignores the namespace stop word when matching', async () => {
    const env = await envWithFormulas();
    try {
      const repository = new FormulaRepository(env.ctx);
      const suggestions = await new FormulaSuggestion(repository).find('overpass_mono');
      expect(suggestions).toContain('macos/overpass_mono');
    } finally {
      await cleanup(env);
    }
  });

  it('returns nothing for unrelated queries', async () => {
    const env = await envWithFormulas();
    try {
      const repository = new FormulaRepository(env.ctx);
      const suggestions = await new FormulaSuggestion(repository).find('zzzzzzzzzz');
      expect(suggestions).toEqual([]);
    } finally {
      await cleanup(env);
    }
  });
});
