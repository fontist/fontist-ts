import { describe, expect, it } from 'vitest';
import { FormatSpec } from '../src/formula/formatSpec.js';
import { FormatMatcher, canConvert } from '../src/formula/formatMatcher.js';
import { FormulaPicker } from '../src/formula/formulaPicker.js';
import { StyleVersion } from '../src/formula/styleVersion.js';
import { Formula } from '../src/formula/formula.js';
import { Resource } from '../src/formula/models.js';
import { FontistVersionError, FormatNotAvailableError, SizeLimitError } from '../src/errors/errors.js';

function resource(name: string, options: Record<string, unknown> = {}): Resource {
  return new Resource({
    name,
    urls: [`https://example.com/${name}.zip`],
    format: 'ttf',
    file_size: 100,
    ...options,
  });
}

function formulaWithNameAndVersions(versions: string[], fileSize = 100): Formula {
  return Formula.fromYaml(`---
name: Test Font Formula
fonts:
- name: Test Font
  styles:
${versions.map((version) => `  - family_name: Test Font\n    type: Regular\n    font: Test-Regular.ttf\n    version: '${version}'`).join('\n')}
resources:
  test.zip:
    urls:
    - https://example.com/test.zip
    file_size: ${fileSize}
`) as Formula;
}

describe('FormatSpec', () => {
  it('detects constraints', () => {
    expect(new FormatSpec().hasConstraints()).toBe(false);
    expect(new FormatSpec({ format: 'woff2' }).hasConstraints()).toBe(true);
    expect(new FormatSpec({ variableAxes: ['wght'] }).hasConstraints()).toBe(true);
    expect(new FormatSpec({ preferVariable: true }).hasConstraints()).toBe(true);
  });

  it('parses comma-separated axes', () => {
    const spec = FormatSpec.fromOptions({ variableAxes: 'wght, wdth ' });
    expect(spec.axes()).toEqual(['wght', 'wdth']);
    expect(spec.variableRequested()).toBe(true);
  });
});

describe('FormatMatcher', () => {
  it('matches resources by format and variable axes', () => {
    const spec = new FormatSpec({ format: 'woff2' });
    const matcher = new FormatMatcher(spec);
    expect(matcher.matchesResource(resource('a', { format: 'woff2' }))).toBe(true);
    expect(matcher.matchesResource(resource('b', { format: 'ttf' }))).toBe(false);
  });

  it('requires variable resources when requested', () => {
    const matcher = new FormatMatcher(new FormatSpec({ preferVariable: true }));
    expect(matcher.matchesResource(resource('var', { variable_axes: ['wght'] }))).toBe(true);
    expect(matcher.matchesResource(resource('static'))).toBe(false);
    const axesMatcher = new FormatMatcher(new FormatSpec({ variableAxes: ['wght', 'wdth'] }));
    expect(axesMatcher.matchesResource(resource('var', { variable_axes: ['wght'] }))).toBe(false);
    expect(axesMatcher.matchesResource(resource('var', { variable_axes: ['wght', 'wdth', 'slnt'] }))).toBe(true);
  });

  it('selects the preferred resource: exact format first, then preferred, then variable', () => {
    const resources = [
      resource('a', { format: 'ttf' }),
      resource('b', { format: 'woff2', variable_axes: ['wght'] }),
      resource('c', { format: 'otf' }),
    ];
    expect(new FormatMatcher(new FormatSpec({ format: 'otf' })).selectPreferredResource(resources)?.name).toBe('c');
    expect(new FormatMatcher(new FormatSpec({ preferFormat: 'otf' })).selectPreferredResource(resources)?.name).toBe('c');
    expect(new FormatMatcher(new FormatSpec({ preferVariable: true })).selectPreferredResource(resources)?.name).toBe('b');
    expect(new FormatMatcher(null).selectPreferredResource(resources)?.name).toBe('a');
    expect(new FormatMatcher(null).selectPreferredResource([])).toBeNull();
  });

  it('reports installation strategies and conversion ability', () => {
    const matcher = new FormatMatcher(new FormatSpec({ format: 'woff2' }));
    expect(matcher.installationStrategy(['ttf'])).toEqual({ strategy: 'convert', from: 'ttf', to: 'woff2' });
    expect(matcher.installationStrategy(['woff2'])).toEqual({ strategy: 'install', format: 'woff2' });
    expect(matcher.installationStrategy(['woff']).strategy).toBe('unavailable');
    expect(matcher.installationStrategy(['otc']).strategy).toBe('convert');
    expect(canConvert('ttf', 'woff2')).toBe(true);
    expect(canConvert('woff2', 'ttf')).toBe(false);
  });
});

describe('StyleVersion', () => {
  it('compares dotted versions, ignoring trailing metadata', () => {
    expect(new StyleVersion('1.2;extra').equals(new StyleVersion('1.2'))).toBe(true);
    expect(new StyleVersion('6.00').equals(new StyleVersion('6.0'))).toBe(false);
    expect(new StyleVersion('6.1').compare(new StyleVersion('6.0.9'))).toBe(1);
    expect(new StyleVersion(null).equals(new StyleVersion(null))).toBe(true);
  });
});

describe('FormulaPicker', () => {
  it('applies the size limit unless resources are cached', async () => {
    const picker = new FormulaPicker('Test Font', { sizeLimitMb: 1 });
    const small = formulaWithNameAndVersions(['1.0'], 500_000);
    const big = formulaWithNameAndVersions(['2.0'], 2_000_000);
    const chosen = await picker.call([small, big]);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.fileSize()).toBe(500_000);
  });

  it('raises SizeLimitError when everything is too large', async () => {
    const picker = new FormulaPicker('Test Font', { sizeLimitMb: 1 });
    await expect(picker.call([formulaWithNameAndVersions(['1.0'], 5_000_000)])).rejects.toBeInstanceOf(SizeLimitError);
  });

  it('bypasses the size limit when resources are already cached', async () => {
    const picker = new FormulaPicker('Test Font', { sizeLimitMb: 1, resourcesCached: async () => true });
    const chosen = await picker.call([formulaWithNameAndVersions(['1.0'], 5_000_000)]);
    expect(chosen).toHaveLength(1);
  });

  it('raises FontistVersionError when min_fontist exceeds the current version', async () => {
    const formula = Formula.fromYaml(`---
min_fontist: 99.0
fonts:
- name: Test Font
  styles:
  - family_name: Test Font
    type: Regular
    font: Test-Regular.ttf
resources:
  test.zip:
    urls:
    - https://example.com/test.zip
`) as Formula;
    const picker = new FormulaPicker('Test Font', { fontistVersion: '1.0.0' });
    await expect(picker.call([formula])).rejects.toBeInstanceOf(FontistVersionError);
  });

  it('filters by requested style version', async () => {
    const v1 = formulaWithNameAndVersions(['1.0']);
    const v2 = formulaWithNameAndVersions(['2.0']);
    const picker = new FormulaPicker('Test Font', { version: '2.0' });
    const chosen = await picker.call([v1, v2]);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.allStyles()[0]!.version).toBe('2.0');
  });

  it('picks the newest version when asked', async () => {
    const v1 = formulaWithNameAndVersions(['1.0']);
    const v2 = formulaWithNameAndVersions(['2.0']);
    const picker = new FormulaPicker('Test Font', { newest: true });
    const chosen = await picker.call([v1, v2]);
    expect(chosen[0]!.allStyles()[0]!.version).toBe('2.0');
  });

  it('raises FormatNotAvailableError when no v5 resource matches the requested format', async () => {
    const formula = Formula.fromYaml(`---
schema_version: 5
fonts:
- name: Test Font
  styles:
  - family_name: Test Font
    type: Regular
    font: Test-Regular.ttf
resources:
  test.zip:
    urls:
    - https://example.com/test.zip
    format: ttf
`) as Formula;
    const picker = new FormulaPicker('Test Font', {
      formatSpec: new FormatSpec({ format: 'woff2' }),
    });
    await expect(picker.call([formula])).rejects.toBeInstanceOf(FormatNotAvailableError);
  });
});
