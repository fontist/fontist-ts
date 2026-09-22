// Mirrors spec/fontist/formula_spec.rb (Ruby gem): licensing per platform,
// v5 loading, matching_resources, .find.
import { describe, expect, it } from 'vitest';
import { Formula } from '../../src/formula/formula.js';
import { FormulaRepository } from '../../src/formula/formulaRepository.js';
import { FormatSpec } from '../../src/formula/formatSpec.js';
import { testEnv, writeFormula, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

const V5 = `---
schema_version: 5
fonts:
- name: Miri
  styles:
  - family_name: Miri
    type: Regular
    font: Miri.ttf
    formats:
    - ttf
    variable_font: true
    variable_axes:
    - wght
resources:
  miri_ttf:
    urls:
    - https://example.invalid/miri.zip
    format: ttf
    variable_axes:
    - wght
`;

describe('#licensed_for_current_platform?', () => {
  it('returns false when platforms exclude the current OS', () => {
    const formula = Formula.fromYaml('platforms:\n- windows\n') as Formula;
    expect(formula.licensedForCurrentPlatform('macos')).toBe(false);
  });

  it('returns false when platforms are empty', () => {
    const formula = Formula.fromYaml('{}') as Formula;
    expect(formula.licensedForCurrentPlatform('macos')).toBe(false);
  });

  it('returns true on exact platform match', () => {
    const formula = Formula.fromYaml('platforms:\n- macos\n') as Formula;
    expect(formula.licensedForCurrentPlatform('macos')).toBe(true);
  });

  it('returns true on os-prefixed platform match', () => {
    const formula = Formula.fromYaml('platforms:\n- macos-font7\n') as Formula;
    expect(formula.licensedForCurrentPlatform('macos')).toBe(true);
  });

  it('returns false for a different OS prefix', () => {
    const formula = Formula.fromYaml('platforms:\n- windows-store\n') as Formula;
    expect(formula.licensedForCurrentPlatform('macos')).toBe(false);
  });
});

describe('v5 formula', () => {
  it('loads v5 formula correctly', () => {
    const formula = Formula.fromYaml(V5) as Formula;
    expect(formula.isV5()).toBe(true);
    expect(formula.effectiveSchemaVersion()).toBe(5);
    expect(formula.resources[0]!.format).toBe('ttf');
    expect(formula.resources[0]!.variableAxes).toEqual(['wght']);
    expect(formula.resources[0]!.isVariableFont()).toBe(true);
    expect(formula.allStyles()[0]!.formats).toEqual(['ttf']);
    expect(formula.allStyles()[0]!.isVariableFont()).toBe(true);
  });

  it('reports v4 as effective schema version 4', () => {
    const formula = Formula.fromYaml('fonts: []\n') as Formula;
    expect(formula.isV5()).toBe(false);
    expect(formula.effectiveSchemaVersion()).toBe(4);
  });

  it('filters matching resources by format', () => {
    const formula = Formula.fromYaml(`${V5}  miri_woff2:
    urls:
    - https://example.invalid/miri.woff2
    format: woff2
`) as Formula;
    const matched = formula.matchingResources(new FormatSpec({ format: 'woff2' }));
    expect(matched).toHaveLength(1);
    expect(matched[0]!.format).toBe('woff2');
    const all = formula.matchingResources(null);
    expect(all).toHaveLength(2);
  });
});

describe('.find', () => {
  it('returns the font formulas via the font index', async () => {
    const e = await env();
    await writeFormula(e, 'miri', {
      name: 'Miri',
      fonts: [
        { name: 'Miri', styles: [{ family_name: 'Miri', type: 'Regular', font: 'Miri.ttf' }] },
      ],
      resources: { 'm.zip': { urls: ['https://example.invalid/m.zip'] } },
    });
    const found = await new FormulaRepository(e.ctx).findFormulasForFont('Miri');
    expect(found.map((f) => f.key())).toEqual(['miri']);
  });
});
