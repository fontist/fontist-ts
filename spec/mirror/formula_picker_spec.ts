// Mirrors spec/fontist/formula_picker_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FormulaPicker } from '../../src/formula/formulaPicker.js';
import { Formula } from '../../src/formula/formula.js';
import { FontistVersionError, SizeLimitError } from '../../src/errors/errors.js';

function formulaWithVersion(version: string, fileSize: number): Formula {
  return Formula.fromYaml(`---
fonts:
- name: Pick Font
  styles:
  - family_name: Pick Font
    type: Regular
    font: PF.ttf
    version: '${version}'
resources:
  p.zip:
    urls:
    - https://example.invalid/p.zip
    file_size: ${fileSize}
`) as Formula;
}

describe('FormulaPicker', () => {
  it('picks the newest formula when requested', async () => {
    const picked = await new FormulaPicker('Pick Font', { newest: true }).call([
      formulaWithVersion('1.0', 100),
      formulaWithVersion('3.0', 300),
      formulaWithVersion('2.0', 200),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.allStyles()[0]!.version).toBe('3.0');
  });

  it('picks the smallest among the max-version formulas', async () => {
    const picked = await new FormulaPicker('Pick Font', {}).call([
      formulaWithVersion('2.0', 300),
      formulaWithVersion('2.0', 100),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.fileSize()).toBe(100);
  });

  it('raises SizeLimitError above the limit', async () => {
    const picker = new FormulaPicker('Pick Font', { sizeLimitMb: 1 });
    await expect(picker.call([formulaWithVersion('1.0', 5_000_000)])).rejects.toBeInstanceOf(SizeLimitError);
  });

  it('raises FontistVersionError without a suitable formula', async () => {
    const heavy = Formula.fromYaml(`---
min_fontist: 99.0
fonts:
- name: Pick Font
  styles:
  - family_name: Pick Font
    type: Regular
    font: PF.ttf
resources:
  p.zip:
    urls:
    - https://example.invalid/p.zip
`) as Formula;
    const picker = new FormulaPicker('Pick Font', { fontistVersion: '1.0.0' });
    await expect(picker.call([heavy])).rejects.toBeInstanceOf(FontistVersionError);
  });
});
