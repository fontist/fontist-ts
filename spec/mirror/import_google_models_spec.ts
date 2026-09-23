// Mirrors spec/fontist/import/google/models/axis_spec.rb,
// spec/fontist/import/google/models/font_family_spec.rb, and
// spec/fontist/import/google/models/font_variant_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { Axis } from '../../src/import/google/models/axis.js';
import { FontFamily } from '../../src/import/google/models/fontFamily.js';
import { FontVariant } from '../../src/import/google/models/fontVariant.js';

describe('Google::Models::Axis', () => {
  const weightAxisJson = { tag: 'wght', start: 100, end: 900 };
  const slantAxisJson = { tag: 'slnt', start: -14, end: 14 };
  const customAxisJson = { tag: 'ARRR', start: 10, end: 60 };

  it('deserializes axes from JSON', () => {
    const weight = Axis.fromYamlObject(weightAxisJson) as Axis;
    expect(weight.tag).toBe('wght');
    expect(weight.start).toBe(100);
    expect(weight.end).toBe(900);

    const slant = Axis.fromYamlObject(slantAxisJson) as Axis;
    expect(slant.tag).toBe('slnt');
    expect(slant.start).toBe(-14);
    expect(slant.end).toBe(14);

    const custom = Axis.fromYamlObject(customAxisJson) as Axis;
    expect(custom.tag).toBe('ARRR');
    expect(custom.start).toBe(10);
    expect(custom.end).toBe(60);
  });

  it('round-trips through serialization', () => {
    const original = Axis.fromYamlObject(weightAxisJson) as Axis;
    const deserialized = Axis.fromYamlObject(original.toYamlObject()) as Axis;
    expect(deserialized.tag).toBe(original.tag);
    expect(deserialized.start).toBe(original.start);
    expect(deserialized.end).toBe(original.end);
  });

  it('classifies standard and custom axes', () => {
    expect((Axis.fromYamlObject(weightAxisJson) as Axis).weightAxis()).toBe(true);
    expect((Axis.fromYamlObject({ tag: 'wdth', start: 100, end: 200 }) as Axis).weightAxis()).toBe(false);

    expect((Axis.fromYamlObject({ tag: 'wdth', start: 100, end: 200 }) as Axis).widthAxis()).toBe(true);
    expect((Axis.fromYamlObject(weightAxisJson) as Axis).widthAxis()).toBe(false);

    expect((Axis.fromYamlObject(slantAxisJson) as Axis).slantAxis()).toBe(true);
    expect((Axis.fromYamlObject(weightAxisJson) as Axis).slantAxis()).toBe(false);

    expect((Axis.fromYamlObject(customAxisJson) as Axis).customAxis()).toBe(true);
    for (const tag of ['wght', 'wdth', 'slnt', 'ital', 'opsz']) {
      expect((Axis.fromYamlObject({ tag, start: 0, end: 100 }) as Axis).customAxis()).toBe(false);
    }
  });

  it('exposes ranges and descriptions', () => {
    const weight = Axis.fromYamlObject(weightAxisJson) as Axis;
    expect(weight.range()).toEqual([100, 900]);

    const slant = Axis.fromYamlObject(slantAxisJson) as Axis;
    expect(slant.range()).toEqual([-14, 14]);

    expect(weight.description()).toBe('wght (weight): 100–900');
    expect((Axis.fromYamlObject({ tag: 'wdth', start: 100, end: 200 }) as Axis).description()).toBe(
      'wdth (width): 100–200',
    );
    expect(slant.description()).toBe('slnt (slant): -14–14');
    expect((Axis.fromYamlObject(customAxisJson) as Axis).description()).toBe('ARRR (custom): 10–60');
  });

  it('handles real-world API examples', () => {
    const arrr = Axis.fromYamlObject({ tag: 'ARRR', start: 10, end: 60 }) as Axis;
    expect(arrr.customAxis()).toBe(true);
    expect(arrr.range()).toEqual([10, 60]);

    const wght = Axis.fromYamlObject({ tag: 'wght', start: 100, end: 1000 }) as Axis;
    expect(wght.weightAxis()).toBe(true);
    expect(wght.range()).toEqual([100, 1000]);
  });
});

describe('Google::Models::FontFamily', () => {
  const staticFontJson = {
    family: 'ABeeZee',
    variants: ['regular', 'italic'],
    subsets: ['latin', 'latin-ext'],
    version: 'v23',
    lastModified: '2025-09-08',
    files: {
      regular: 'https://fonts.gstatic.com/s/abeezee/v23/test.ttf',
      italic: 'https://fonts.gstatic.com/s/abeezee/v23/test-italic.ttf',
    },
    category: 'sans-serif',
    kind: 'webfonts#webfont',
    menu: 'https://fonts.gstatic.com/s/abeezee/v23/menu.ttf',
  };

  const variableFontJson = {
    family: 'AR One Sans',
    variants: ['regular'],
    subsets: ['latin'],
    version: 'v6',
    lastModified: '2025-09-08',
    files: { regular: 'https://fonts.gstatic.com/s/aronesans/v6/test.ttf' },
    category: 'sans-serif',
    kind: 'webfonts#webfont',
    axes: [
      { tag: 'ARRR', start: 10, end: 60 },
      { tag: 'wght', start: 400, end: 700 },
    ],
  };

  it('deserializes a static font from JSON', () => {
    const family = FontFamily.fromYamlObject(staticFontJson) as FontFamily;
    expect(family.family).toBe('ABeeZee');
    expect(family.variants).toEqual(['regular', 'italic']);
    expect(family.subsets).toEqual(['latin', 'latin-ext']);
    expect(family.version).toBe('v23');
    expect(family.lastModified).toBe('2025-09-08');
    expect(family.category).toBe('sans-serif');
    expect(family.kind).toBe('webfonts#webfont');
    expect(typeof family.menu).toBe('string');
    expect(family.files()).toBeTypeOf('object');
  });

  it('deserializes a variable font with axes from JSON', () => {
    const family = FontFamily.fromYamlObject(variableFontJson) as FontFamily;
    expect(family.axes).toHaveLength(2);
    expect(family.axes![0]!.tag).toBe('ARRR');
    expect(family.axes![1]!.tag).toBe('wght');
  });

  it('round-trips through serialization', () => {
    const original = FontFamily.fromYamlObject(variableFontJson) as FontFamily;
    const deserialized = FontFamily.fromYamlObject(original.toYamlObject()) as FontFamily;
    expect(deserialized.family).toBe(original.family);
    expect(deserialized.variants).toEqual(original.variants);
    expect(deserialized.axes).toHaveLength(original.axes!.length);
  });

  it('classifies variable fonts', () => {
    const variable = new FontFamily({
      family: 'AR One Sans',
      axes: [{ tag: 'wght', start: 100, end: 900 }],
    });
    expect(variable.variableFont()).toBe(true);
    expect(new FontFamily({ family: 'ABeeZee' }).variableFont()).toBe(false);
    expect(new FontFamily({ family: 'ABeeZee', axes: [] }).variableFont()).toBe(false);
  });

  it('filters variants by format', () => {
    const family = new FontFamily({
      family: 'Test Font',
      files: {
        regular: 'https://example.com/font.ttf',
        italic: 'https://example.com/font-italic.ttf',
        bold: 'https://example.com/font-bold.woff2',
      },
    });
    expect(Object.keys(family.variantsByFormat('ttf'))).toEqual(
      expect.arrayContaining(['regular', 'italic']),
    );
    expect(Object.keys(family.variantsByFormat('ttf'))).not.toContain('bold');
    expect(Object.keys(family.variantsByFormat('woff2'))).toEqual(['bold']);
    expect(new FontFamily({ family: 'Test', files: null }).variantsByFormat('ttf')).toEqual({});
  });

  it('finds axes by tag', () => {
    const family = new FontFamily({
      family: 'Variable Font',
      axes: [
        { tag: 'wght', start: 100, end: 900 },
        { tag: 'wdth', start: 75, end: 125 },
      ],
    });
    const axis = family.axisByTag('wght');
    expect(axis).not.toBeNull();
    expect(axis!.tag).toBe('wght');
    expect(axis!.start).toBe(100);
    expect(family.axisByTag('slnt')).toBeNull();
    expect(new FontFamily({ family: 'Static' }).axisByTag('wght')).toBeNull();
  });

  it('splits axes by kind', () => {
    const family = new FontFamily({
      family: 'Test',
      axes: [
        { tag: 'wght', start: 100, end: 900 },
        { tag: 'wdth', start: 75, end: 125 },
        { tag: 'slnt', start: -10, end: 10 },
        { tag: 'ARRR', start: 10, end: 60 },
      ],
    });
    expect(family.weightAxes().map((a) => a.tag)).toEqual(['wght']);
    expect(family.widthAxes().map((a) => a.tag)).toEqual(['wdth']);
    expect(family.slantAxes().map((a) => a.tag)).toEqual(['slnt']);
    expect(family.customAxes().map((a) => a.tag)).toEqual(['ARRR']);
    expect(family.axesCount()).toBe(4);
    expect(new FontFamily({ family: 'Static' }).axesCount()).toBe(0);
  });

  it('answers variant and file queries', () => {
    const family = new FontFamily({
      family: 'Test',
      version: 'v23',
      variants: ['regular', 'italic'],
      files: {
        regular: 'https://example.com/font.ttf',
        italic: 'https://example.com/font-italic.ttf',
      },
    });
    expect(family.variantNames()).toEqual(['regular', 'italic']);
    expect(family.fileUrls()).toHaveLength(2);
    expect(family.variantExists('regular')).toBe(true);
    expect(family.variantExists('bold')).toBe(false);
    expect(family.variantUrl('regular')).toBe('https://example.com/font.ttf');
    expect(family.variantUrl('bold')).toBeNull();
    expect(family.summary()).toBe('Test v23');
  });
});

describe('Google::Models::FontVariant', () => {
  it('answers format queries', () => {
    const ttf = new FontVariant({ name: 'Regular', url: 'https://example.com/a.ttf', format: 'ttf' });
    expect(ttf.ttf()).toBe(true);
    expect(ttf.extension()).toBe('.ttf');
    expect(ttf.validFormat()).toBe(true);
    expect(ttf.description()).toBe('Regular (ttf)');

    const woff2 = new FontVariant({ name: 'Regular', url: 'https://example.com/a.woff2', format: 'woff2' });
    expect(woff2.woff2()).toBe(true);
    expect(woff2.extension()).toBe('.woff2');
    expect(woff2.validFormat()).toBe(true);

    const bogus = new FontVariant({ name: 'X', format: 'svg' });
    expect(bogus.validFormat()).toBe(false);
    expect(bogus.extension()).toBe('');
  });
});
