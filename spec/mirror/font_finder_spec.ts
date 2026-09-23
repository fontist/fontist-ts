// Mirrors spec/fontist/font_finder_spec.rb and the find-related examples of
// spec/fontist/font_spec.rb (Ruby gem).
import { afterEach, describe, expect, it } from 'vitest';
import { detectCategoryFromName, FontFinder } from '../../src/formula/fontFinder.js';
import { FormatSpec } from '../../src/formula/formatSpec.js';
import { Formula } from '../../src/formula/formula.js';
import { FormulaRepository, nameToKey } from '../../src/formula/formulaRepository.js';
import { cleanup, testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

const VAR_YAML = `---
schema_version: 5
name: Mono Var
fonts:
- name: Mono Var
  styles:
  - family_name: Mono Var
    type: Regular
    font: MonoVar.ttf
resources:
  var_ttf:
    urls:
    - https://example.invalid/var.ttf
    format: ttf
    variable_axes:
    - wght
    - wdth
  var_woff2:
    urls:
    - https://example.invalid/var.woff2
    format: woff2
    variable_axes:
    - wght
  static_ttf:
    urls:
    - https://example.invalid/static.ttf
    format: ttf
`;

function varFormula(): Formula {
  return Formula.fromYaml(VAR_YAML) as Formula;
}

describe('FontFinder', () => {
  it('finds fonts supporting all requested axes', () => {
    const finder = new FontFinder([varFormula()]);
    const both = finder.byAxes(['wght', 'wdth']);
    expect(both).toHaveLength(1);
    expect(both[0]!.toObject()).toMatchObject({
      name: 'Mono Var',
      resource: 'var_ttf',
      axes: ['wght', 'wdth'],
      format: 'ttf',
      category: 'monospace',
    });
    expect(finder.byAxes(['wght'])).toHaveLength(2);
    expect(finder.byAxes(['slnt'])).toHaveLength(0);
  });

  it('finds all variable fonts', () => {
    const finder = new FontFinder([varFormula()]);
    const variables = finder.variableFonts();
    expect(variables).toHaveLength(2);
    expect(variables.map((m) => m.toObject().resource).sort()).toEqual(['var_ttf', 'var_woff2']);
  });

  it('filters by format', () => {
    const finder = new FontFinder([varFormula()], {
      formatSpec: FormatSpec.fromOptions({ format: 'woff2' }),
    });
    const variables = finder.variableFonts();
    expect(variables).toHaveLength(1);
    expect(variables[0]!.toObject().format).toBe('woff2');
  });

  it('matches categories by the documented name heuristics', () => {
    expect(detectCategoryFromName('JetBrains Mono')).toBe('monospace');
    expect(detectCategoryFromName('Open Sans')).toBe('sans-serif');
    expect(detectCategoryFromName('Source Serif')).toBe('serif');
    expect(detectCategoryFromName('Overpass')).toBe('sans-serif');
    const finder = new FontFinder([varFormula()]);
    expect(finder.byCategory('monospace')).toHaveLength(1);
    expect(finder.byCategory('serif')).toHaveLength(0);
  });

  it('compacts null keys from results like Ruby to_h', () => {
    const [match] = new FontFinder([varFormula()]).byCategory('monospace');
    const data = match!.toObject();
    expect(data).not.toHaveProperty('resource');
    expect(data).not.toHaveProperty('format');
    expect(data).not.toHaveProperty('axes');
  });
});

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
  });

  it('returns matching fonts and styles case-insensitively (find_fonts/find_styles)', async () => {
    const e = await env();
    await writeFormula(e, 'mono_var', {
      name: 'Mono Var',
      schema_version: 5,
      fonts: [
        {
          name: 'Mono Var',
          styles: [
            { family_name: 'Mono Var', type: 'Regular', font: 'MonoVar-Regular.ttf' },
            { family_name: 'Mono Var', type: 'Bold', font: 'MonoVar-Bold.ttf' },
          ],
        },
      ],
      resources: { 'm.zip': { urls: ['https://example.invalid/m.zip'] } },
    });
    const repo = new FormulaRepository(e.ctx);
    const fonts = await repo.findFonts('MONO VAR');
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.name).toBe('Mono Var');
    const styles = await repo.findStyles('mono var', 'bold');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.font).toBe('MonoVar-Bold.ttf');
    expect(await repo.findStyles('mono var', 'italic')).toHaveLength(0);
  });
});
