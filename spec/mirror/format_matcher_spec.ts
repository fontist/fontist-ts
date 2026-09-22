// Mirrors spec/fontist/format_matcher_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import { FormatMatcher, canConvert } from '../../src/formula/formatMatcher.js';
import { FormatSpec } from '../../src/formula/formatSpec.js';
import { Resource } from '../../src/formula/models.js';

function resource(name: string, fields: Record<string, unknown>): Resource {
  return new Resource({ name, urls: ['u'], ...fields });
}

describe('FormatMatcher#matchesResource', () => {
  it('matches by format', () => {
    const matcher = new FormatMatcher(new FormatSpec({ format: 'woff2' }));
    expect(matcher.matchesResource(resource('w', { format: 'woff2' }))).toBe(true);
    expect(matcher.matchesResource(resource('t', { format: 'ttf' }))).toBe(false);
  });

  it('requires subset of requested axes', () => {
    const matcher = new FormatMatcher(new FormatSpec({ variableAxes: ['wght'] }));
    expect(matcher.matchesResource(resource('v', { variable_axes: ['wght', 'slnt'] }))).toBe(true);
    expect(matcher.matchesResource(resource('s', { variable_axes: ['slnt'] }))).toBe(false);
  });
});

describe('FormatMatcher#installationStrategy', () => {
  it('prefers install, then convert, then unavailable', () => {
    const matcher = new FormatMatcher(new FormatSpec({ format: 'woff' }));
    expect(matcher.installationStrategy(['woff'])).toEqual({ strategy: 'install', format: 'woff' });
    expect(matcher.installationStrategy(['otf'])).toEqual({ strategy: 'convert', from: 'otf', to: 'woff' });
    expect(matcher.installationStrategy(['woff2']).strategy).toBe('unavailable');
  });
});

describe('canConvert', () => {
  it('only converts desktop to web', () => {
    expect(canConvert('ttf', 'woff')).toBe(true);
    expect(canConvert('ttc', 'woff')).toBe(true);
    expect(canConvert('woff', 'ttf')).toBe(false);
  });
});
