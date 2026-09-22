// Mirrors spec/fontist/indexes/default_family_font_index_spec.rb, spec/fontist/indexes/preferred_family_font_index_spec.rb, spec/fontist/indexes/filename_index_spec.rb (Ruby gem): index keying and config dispatch.
import { describe, expect, it } from 'vitest';
import {
  DefaultFamilyFontIndex,
  FormulaFilenameIndex,
  FormulaIndexRegistry,
  PreferredFamilyFontIndex,
} from '../../src/index/formula/formulaFontIndex.js';
import { FormulaRepository } from '../../src/formula/formulaRepository.js';
import { cleanup, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function envWithFamilyFormula(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  await writeFormula(e, 'family_font', {
    fonts: [
      {
        name: 'Family Font',
        styles: [
          {
            family_name: 'Family Font',
            type: 'Regular',
            font: 'FamilyFont-Regular.ttf',
            preferred_family_name: 'Family Font Preferred',
            preferred_type: 'Regular',
          },
        ],
      },
    ],
    resources: { 'ff.zip': { urls: ['https://example.invalid/ff.zip'] } },
  });
  return e;
}

describe('DefaultFamilyFontIndex', () => {
  it('indexes by default family name (lowercased)', async () => {
    const e = await envWithFamilyFormula();
    const repo = new FormulaRepository(e.ctx);
    const index = new DefaultFamilyFontIndex(e.ctx, repo);
    await index.rebuild();
    expect(await index.loadFormulas('FAMILY FONT')).toHaveLength(1);
    // preferred names are not keys of the default-family index
    expect(await index.loadFormulas('Family Font Preferred')).toHaveLength(0);
    await cleanup(e);
  });
});

describe('PreferredFamilyFontIndex', () => {
  it('indexes by preferred family name', async () => {
    const e = await envWithFamilyFormula();
    const repo = new FormulaRepository(e.ctx);
    const index = new PreferredFamilyFontIndex(e.ctx, repo);
    await index.rebuild();
    const found = await index.loadFormulas('family font preferred');
    expect(found).toHaveLength(1);
    await cleanup(e);
  });
});

describe('FormulaIndexRegistry dispatch', () => {
  it('picks the preferred-family index when config sets preferred_family', async () => {
    const e = await envWithFamilyFormula();
    e.ctx.config.set('preferred_family', true);
    const repo = new FormulaRepository(e.ctx);
    const registry = new FormulaIndexRegistry(e.ctx, repo);
    const found = await registry.fontIndex().loadFormulas('family font preferred');
    expect(found).toHaveLength(1);
    await cleanup(e);
  });

  it('picks the default-family index otherwise', async () => {
    const e = await envWithFamilyFormula();
    const repo = new FormulaRepository(e.ctx);
    const registry = new FormulaIndexRegistry(e.ctx, repo);
    const found = await registry.fontIndex().loadFormulas('family font');
    expect(found).toHaveLength(1);
    await cleanup(e);
  });
});

describe('FormulaFilenameIndex', () => {
  it('indexes by exact installed filename', async () => {
    const e = await envWithFamilyFormula();
    const repo = new FormulaRepository(e.ctx);
    const index = new FormulaFilenameIndex(e.ctx, repo);
    await index.rebuild();
    expect(await index.loadFormulasByFile('FamilyFont-Regular.ttf')).toHaveLength(1);
    expect(await index.loadFormulasByFile('familyfont-regular.ttf')).toHaveLength(0);
    await cleanup(e);
  });
});
