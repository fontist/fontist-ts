// Mirrors fontist/errors_spec.rb (Ruby gem): representative coverage.
import { describe, expect, it } from 'vitest';
import {
  FontIndexCorrupted,
  FontistVersionError,
  FormulaNotFoundError,
  LicensingError,
  MainRepoNotFoundError,
  ManualFontError,
  ManifestCouldNotBeFoundError,
  ManifestCouldNotBeReadError,
  MissingFontError,
  PlatformMismatchError,
  RepoCouldNotBeUpdatedError,
  RepoNotFoundError,
  SizeLimitError,
  UnsupportedFontError,
  FontistError,
  FormatNotAvailableError,
  TamperedFileError,
} from '../src/errors/errors.js';
import {
  STATUS_FONTIST_VERSION_ERROR,
  STATUS_FORMULA_NOT_FOUND,
  STATUS_LICENSING_ERROR,
  STATUS_MANUAL_FONT_ERROR,
  STATUS_MISSING_FONT_ERROR,
  STATUS_NON_SUPPORTED_FONT_ERROR,
  STATUS_REPO_COULD_NOT_BE_UPDATED,
  STATUS_REPO_NOT_FOUND,
  STATUS_SIZE_LIMIT_ERROR,
  STATUS_UNKNOWN_ERROR,
  exitCodeFor,
} from '../src/cli/exitCodes.js';

describe('error taxonomy', () => {
  it('names errors after their classes', () => {
    const err = new MissingFontError('Crimson Text');
    expect(err.name).toBe('MissingFontError');
    expect(err).toBeInstanceOf(FontistError);
  });

  it('formats font errors with style context', () => {
    expect(new MissingFontError('Crimson Text').message).toContain('is not installed');
    expect(new MissingFontError('Crimson Text', 'Italic').message).toContain('with style "Italic"');
    expect(new UnsupportedFontError('X').message).toContain('not supported');
    expect(new ManualFontError('X', 'see example.com').message).toContain('see example.com');
  });

  it('formats platform mismatch with both platforms', () => {
    const err = new PlatformMismatchError('X', ['windows'], 'macos');
    expect(err.message).toContain('windows');
    expect(err.message).toContain('macos');
    expect(err.requiredPlatforms).toEqual(['windows']);
    expect(err.currentPlatform).toBe('macos');
  });

  it('describes checksum and format failures precisely', () => {
    expect(new TamperedFileError('abc').message).toContain('abc');
    const fmt = new FormatNotAvailableError('X', 'woff2', ['ttf', 'otf']);
    expect(fmt.message).toContain('woff2');
    expect(fmt.message).toContain('ttf, otf');
  });
});

describe('CLI exit code mapping', () => {
  it('maps each error class to its status code', () => {
    expect(exitCodeFor(new UnsupportedFontError('X'))).toBe(STATUS_NON_SUPPORTED_FONT_ERROR);
    expect(exitCodeFor(new MissingFontError('X'))).toBe(STATUS_MISSING_FONT_ERROR);
    expect(exitCodeFor(new LicensingError())).toBe(STATUS_LICENSING_ERROR);
    expect(exitCodeFor(new ManualFontError('X', null))).toBe(STATUS_MANUAL_FONT_ERROR);
    expect(exitCodeFor(new ManifestCouldNotBeFoundError())).toBe(5);
    expect(exitCodeFor(new ManifestCouldNotBeReadError())).toBe(6);
    expect(exitCodeFor(new FontIndexCorrupted())).toBe(7);
    expect(exitCodeFor(new RepoNotFoundError('x'))).toBe(STATUS_REPO_NOT_FOUND);
    expect(exitCodeFor(new MainRepoNotFoundError())).toBe(9);
    expect(exitCodeFor(new RepoCouldNotBeUpdatedError())).toBe(STATUS_REPO_COULD_NOT_BE_UPDATED);
    expect(exitCodeFor(new SizeLimitError())).toBe(STATUS_SIZE_LIMIT_ERROR);
    expect(exitCodeFor(new FormulaNotFoundError('x'))).toBe(STATUS_FORMULA_NOT_FOUND);
    expect(exitCodeFor(new FontistVersionError())).toBe(STATUS_FONTIST_VERSION_ERROR);
  });

  it('maps unknown errors to the generic code', () => {
    expect(exitCodeFor(new Error('mystery'))).toBeNull();
    const unknownFontist = new FormatNotAvailableError('X', 'a', []);
    expect(exitCodeFor(unknownFontist)).toBe(STATUS_UNKNOWN_ERROR);
  });
});
