// Mirrors spec/fontist/formula_suggestion_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FormulaSuggestion } from '../../src/formula/formulaSuggestion.js';
import { FormulaRepository } from '../../src/formula/formulaRepository.js';
import { cleanup, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  await writeFormula(e, 'sourcehan', {
    name: 'Source Han',
    fonts: [
      { name: 'Source Han', styles: [{ family_name: 'Source Han', type: 'Regular', font: 'SH.ttf' }] },
    ],
    resources: { 's.zip': { urls: ['https://example.invalid/s.zip'] } },
  });
  await writeFormula(e, 'manual_thing', {
    name: 'Manual Thing',
    fonts: [
      { name: 'Manual Thing', styles: [{ family_name: 'Manual Thing', type: 'Regular', font: 'MT.ttf' }] },
    ],
  });
  return e;
}

describe('FormulaSuggestion', () => {
  it('suggests near matches', async () => {
    const e = await env();
    const suggestions = await new FormulaSuggestion(new FormulaRepository(e.ctx)).find('source hann');
    expect(suggestions).toContain('sourcehan');
    await cleanup(e);
  });

  it('excludes manual formulas', async () => {
    const e = await env();
    const suggestions = await new FormulaSuggestion(new FormulaRepository(e.ctx)).find('manual thang');
    expect(suggestions).not.toContain('manual_thing');
    await cleanup(e);
  });
});
