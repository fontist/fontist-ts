// Mirrors spec/fontist/font_license_confirmation_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { TranscodeLicenseNotAcceptedError } from '../../src/errors/errors.js';
import { checkTranscodeLicense } from '../../src/installer/transcode.js';
import { Formula } from '../../src/formula/formula.js';

describe('license confirmation', () => {
  it('does not require confirmation for open-license formulas', () => {
    const formula = Formula.fromYaml('open_license: MIT text\n') as Formula;
    expect(formula.licenseRequired()).toBe(false);
    expect(formula.license()).toBe('MIT text');
  });

  it('requires confirmation when requires_license_agreement is set', () => {
    const formula = Formula.fromYaml('requires_license_agreement: CONTACT US\n') as Formula;
    expect(formula.licenseRequired()).toBe(true);
    expect(formula.license()).toBe('CONTACT US');
  });

  it('treats only literal yes as acceptance for transcodes', () => {
    expect(() => checkTranscodeLicense('yes')).not.toThrow();
    expect(() => checkTranscodeLicense('YES')).not.toThrow();
    expect(() => checkTranscodeLicense('y')).toThrow(TranscodeLicenseNotAcceptedError);
  });
});
