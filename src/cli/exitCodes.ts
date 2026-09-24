import { FontistError } from '../errors/errors.js';
import {
  FontIndexCorrupted,
  FontconfigFileNotFoundError,
  FontconfigNotFoundError,
  FontistVersionError,
  FormulaNotFoundError,
  LicensingError,
  MainRepoNotFoundError,
  ManualFontError,
  ManifestCouldNotBeFoundError,
  ManifestCouldNotBeReadError,
  MissingFontError,
  RepoCouldNotBeUpdatedError,
  RepoNotFoundError,
  SizeLimitError,
  UnsupportedFontError,
  InvalidConfigAttributeError,
} from '../errors/errors.js';

/** Exit codes mirrored from the Ruby CLI. */
export const STATUS_SUCCESS = 0;
export const STATUS_UNKNOWN_ERROR = 1;
export const STATUS_NON_SUPPORTED_FONT_ERROR = 2;
export const STATUS_MISSING_FONT_ERROR = 3;
export const STATUS_LICENSING_ERROR = 4;
export const STATUS_MANIFEST_COULD_NOT_BE_FOUND_ERROR = 5;
export const STATUS_MANIFEST_COULD_NOT_BE_READ_ERROR = 6;
export const STATUS_FONT_INDEX_CORRUPTED = 7;
export const STATUS_REPO_NOT_FOUND = 8;
export const STATUS_MAIN_REPO_NOT_FOUND = 9;
export const STATUS_REPO_COULD_NOT_BE_UPDATED = 10;
export const STATUS_MANUAL_FONT_ERROR = 11;
export const STATUS_SIZE_LIMIT_ERROR = 12;
export const STATUS_FORMULA_NOT_FOUND = 13;
export const STATUS_FONTCONFIG_NOT_FOUND = 14;
export const STATUS_FONTCONFIG_FILE_NOT_FOUND = 15;
/** Ruby collision fix: 15 was shared with FONTCONFIG_FILE_NOT_FOUND. */
export const STATUS_FONTIST_VERSION_ERROR = 17;
export const STATUS_INVALID_CONFIG_ATTRIBUTE = 16;

/** Maps an error to its CLI exit code, or null when unknown. */
export function exitCodeFor(error: Error): number | null {
  if (error instanceof UnsupportedFontError) return STATUS_NON_SUPPORTED_FONT_ERROR;
  if (error instanceof MissingFontError) return STATUS_MISSING_FONT_ERROR;
  if (error instanceof LicensingError) return STATUS_LICENSING_ERROR;
  if (error instanceof ManualFontError) return STATUS_MANUAL_FONT_ERROR;
  if (error instanceof ManifestCouldNotBeFoundError) return STATUS_MANIFEST_COULD_NOT_BE_FOUND_ERROR;
  if (error instanceof ManifestCouldNotBeReadError) return STATUS_MANIFEST_COULD_NOT_BE_READ_ERROR;
  if (error instanceof FontIndexCorrupted) return STATUS_FONT_INDEX_CORRUPTED;
  if (error instanceof RepoNotFoundError) return STATUS_REPO_NOT_FOUND;
  if (error instanceof MainRepoNotFoundError) return STATUS_MAIN_REPO_NOT_FOUND;
  if (error instanceof RepoCouldNotBeUpdatedError) return STATUS_REPO_COULD_NOT_BE_UPDATED;
  if (error instanceof FormulaNotFoundError) return STATUS_FORMULA_NOT_FOUND;
  if (error instanceof FontconfigNotFoundError) return STATUS_FONTCONFIG_NOT_FOUND;
  if (error instanceof FontconfigFileNotFoundError) return STATUS_FONTCONFIG_FILE_NOT_FOUND;
  if (error instanceof FontistVersionError) return STATUS_FONTIST_VERSION_ERROR;
  if (error instanceof SizeLimitError) return STATUS_SIZE_LIMIT_ERROR;
  if (error instanceof InvalidConfigAttributeError) return STATUS_INVALID_CONFIG_ATTRIBUTE;
  if (error instanceof FontistError) return STATUS_UNKNOWN_ERROR;
  return null;
}

export function sizeLimitHint(): string {
  return 'Please specify higher `--size-limit`, or use the `--newest` or `--smallest` options.';
}
