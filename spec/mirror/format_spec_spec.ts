// Mirrors spec/fontist/format_spec_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FormatSpec } from '../../src/formula/formatSpec.js';

describe('FormatSpec', () => {
  it('has no constraints by default', () => {
    const spec = new FormatSpec();
    expect(spec.hasConstraints()).toBe(false);
    expect(spec.variableRequested()).toBe(false);
    expect(spec.axes()).toEqual([]);
  });

  it('treats axes and variable preference as constraints', () => {
    expect(new FormatSpec({ variableAxes: ['wght'] }).hasConstraints()).toBe(true);
    expect(new FormatSpec({ preferVariable: true }).variableRequested()).toBe(true);
  });

  it('detects collection index requirements', () => {
    expect(new FormatSpec().hasSpecificCollectionIndex()).toBe(false);
    expect(new FormatSpec({ collectionIndex: 2 }).hasSpecificCollectionIndex()).toBe(true);
  });
});
