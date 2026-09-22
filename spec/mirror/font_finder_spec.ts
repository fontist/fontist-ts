// Mirrors spec/fontist/font_finder_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FormulaRepository, nameToKey } from '../../src/formula/formulaRepository.js';
import { cleanup, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

describe('FormulaRepository lookup (FontFinder)', () => {
  it('finds by font name through the font index', async () => {
    const e = await env();
    await writeFormula(e, 'finder_font', {
      fonts: [
        { name: 'Finder Font', styles: [{ family_name: 'Finder Font', type: 'Regular', font: 'FF.ttf' }] },
      ],
      resources: { 'ff.zip': { urls: ['https://example.invalid/ff.zip'] } },
    });
    const formulas = await new FormulaRepository(e.ctx).findFormulasForFont('finder font');
    expect(formulas.map((f) => f.key())).toEqual(['finder_font']);
    await cleanup(e);
  });

  it('normalizes spaces to underscores for name lookup', () => {
    expect(nameToKey('Crimson Text')).toBe('crimson_text');
  });

  it('finds by font file through the filename index', async () => {
    const e = await env();
    await writeFormula(e, 'byfile_font', {
      fonts: [
        { name: 'ByFile', styles: [{ family_name: 'ByFile', type: 'Regular', font: 'ByFile.ttf' }] },
      ],
      resources: { 'b.zip': { urls: ['https://example.invalid/b.zip'] } },
    });
    const repo = new FormulaRepository(e.ctx);
    expect((await repo.findByFontFile('/x/ByFile.ttf'))?.key()).toBe('byfile_font');
    expect(await repo.findByFontFile('/x/Nothing.ttf')).toBeNull();
    await cleanup(e);
  });
});
