// Mirrors spec/fontist/font_model_spec.rb, spec/fontist/font_style_spec.rb, spec/fontist/font_collection_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FontCollection, FontStyle, Resource } from '../../src/formula/models.js';

describe('FontModel/FontStyle', () => {
  it('parses style attributes including v5 fields', () => {
    const style = new FontStyle({
      family_name: 'F', type: 'Regular', full_name: 'F Regular',
      preferred_family_name: 'PF', formats: ['ttf'], variable_font: true, variable_axes: ['wght'],
    });
    expect(style.familyName).toBe('F');
    expect(style.preferredFamilyName).toBe('PF');
    expect(style.formats).toEqual(['ttf']);
    expect(style.isVariableFont()).toBe(true);
  });

  it('is variable only when literally true', () => {
    expect(new FontStyle({ variable_font: false }).isVariableFont()).toBe(false);
    expect(new FontStyle({}).isVariableFont()).toBe(false);
  });
});

describe('FontCollection', () => {
  it('holds filename and faces', () => {
    const collection = new FontCollection({
      filename: 'Pack.ttc',
      fonts: [{ name: 'Pack', styles: [{ family_name: 'Pack', type: 'Regular' }] }],
    });
    expect(collection.filename).toBe('Pack.ttc');
    expect(collection.fonts[0]!.name).toBe('Pack');
  });
});

describe('Resource helpers', () => {
  it('detects variable and collection resources', () => {
    const variable = new Resource({ name: 'v', variable_axes: ['wght'] });
    expect(variable.isVariableFont()).toBe(true);
    const collection = new Resource({ name: 'c', format: 'ttc' });
    expect(collection.isCollectionFile()).toBe(true);
    const plain = new Resource({ name: 'p', format: 'ttf', urls: ['u'] });
    expect(plain.isVariableFont()).toBe(false);
    expect(plain.isEmpty()).toBe(false);
  });
});
