import type { FontistPlatform } from '../ui/ui.js';

export class FontistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// ── Formula ─────────────────────────────────────────────────────────────────

export class FormulaNotFoundError extends FontistError {
  constructor(query: string) {
    super(`Could not find formula "${query}" in the known formulas repositories.`);
  }
}

export class FormulaInvalidError extends FontistError {}

export class UnsupportedSchemaVersionError extends FontistError {
  constructor(version: number | null) {
    super(`Unsupported formula schema version: ${version ?? '(missing)'} (supported: 4, 5)`);
  }
}

export class MainRepoNotFoundError extends FontistError {
  constructor(message = 'The main formulas repository could not be found.') {
    super(message);
  }
}

// ── Font lookup ─────────────────────────────────────────────────────────────

export class FontError extends FontistError {
  constructor(
    message: string,
    public readonly font: string | null,
    public readonly style: string | null = null,
  ) {
    super(message);
  }
}

export class MissingFontError extends FontistError {
  constructor(
    public readonly font: string,
    style?: string | null,
  ) {
    super(
      style
        ? `Font "${font}" with style "${style}" is not installed in the system.`
        : `Font "${font}" is not installed in the system.`,
    );
  }
}

export class ManualFontError extends FontistError {
  constructor(font: string, instructions: string | null) {
    super(
      `Font "${font}" is provided in a formula, but it doesn't include any downloadable` +
        ` font file.\n${instructions ?? ''}`,
    );
  }
}

export class UnsupportedFontError extends FontistError {
  constructor(font: string) {
    super(`"${font}" font is not supported by any formula`);
  }
}

export class PlatformMismatchError extends FontError {
  constructor(
    font: string,
    public readonly requiredPlatforms: string[],
    public readonly currentPlatform: FontistPlatform,
  ) {
    super(
      `Font "${font}" is not available for your platform: ${currentPlatform}` +
        ` (requires: ${requiredPlatforms.join(', ')}).` +
        ` This font cannot be installed on your system.`,
      font,
    );
  }
}

export class FontNotFoundError extends FontistError {
  constructor(
    message: string,
    public readonly parsingErrors: string[] = [],
  ) {
    super(message);
  }

  hasParsingErrors(): boolean {
    return this.parsingErrors.length > 0;
  }
}

// ── Install ─────────────────────────────────────────────────────────────────

export class LicensingError extends FontistError {
  constructor(message = 'Fontist will not download these fonts unless you accept the terms.') {
    super(message);
  }
}

export class FontistVersionError extends FontistError {
  constructor(message = 'Suitable formulas require higher version of fontist. Please upgrade fontist.') {
    super(message);
  }
}

export class WindowsFodInstallError extends FontistError {}

export class UnsupportedMacOSVersionError extends FontistError {}

export class TranscodeLicenseNotAcceptedError extends FontistError {
  constructor() {
    super(
      'Fontist will not transcode these fonts unless you accept the terms of their license.',
    );
  }
}

// ── Download ────────────────────────────────────────────────────────────────

export class InvalidResourceError extends FontistError {}

export class TamperedFileError extends FontistError {
  constructor(digest: string) {
    super(`Given file doesn't have checksum: ${digest}`);
  }
}

export class SizeLimitError extends FontistError {
  constructor(message = 'There are only formulas above the size limit.') {
    super(message);
  }
}

export class TimeoutError extends FontistError {
  constructor(message = 'Request timed out.') {
    super(message);
  }
}

// ── Font files and archives ─────────────────────────────────────────────────

export class FontFileError extends FontistError {}

export class FontIndexabilityValidationError extends FontFileError {}

export class UnknownFontTypeError extends FontistError {}

export class UnknownArchiveError extends FontistError {}

export class FontExtractError extends FontistError {}

export class CollectionIndexError extends FontistError {}

// ── Infrastructure ──────────────────────────────────────────────────────────

export class RepoNotFoundError extends FontistError {
  constructor(name: string) {
    super(`Repository "${name}" not found.`);
  }
}

export class RepoCouldNotBeUpdatedError extends FontistError {
  constructor(message = 'Repository could not be updated.') {
    super(message);
  }
}

export class ManifestCouldNotBeFoundError extends FontistError {
  constructor(message = 'Manifest could not be found.') {
    super(message);
  }
}

export class ManifestCouldNotBeReadError extends FontistError {
  constructor(message = 'Manifest could not be read.') {
    super(message);
  }
}

export class FontconfigNotFoundError extends FontistError {}

export class FontconfigFileNotFoundError extends FontistError {}

export class FontIndexCorrupted extends FontistError {
  constructor(message = 'The font index is corrupted; rebuild it with `fontist index rebuild`.') {
    super(message);
  }
}

export class InvalidConfigAttributeError extends FontistError {
  constructor(key: string) {
    super(`Invalid config attribute: ${key}`);
  }
}

export class BinaryCallError extends FontistError {}

export class UnsupportedTranscodeError extends FontistError {}

export class FormatNotAvailableError extends FontistError {
  constructor(
    font: string,
    requestedFormat: string | null | undefined,
    availableFormats: (string | null | undefined)[],
  ) {
    const available = availableFormats.filter(Boolean);
    super(
      `Format "${requestedFormat ?? '(any)'}" is not available for font "${font}".` +
        (available.length > 0
          ? ` Available formats: ${available.join(', ')}.`
          : ' No formats are declared in the formulas.'),
    );
  }
}
