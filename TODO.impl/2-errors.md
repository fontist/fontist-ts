Status: DONE — implemented and verified this session.

# 2 — Errors taxonomy

Priority: 1

## Deliverable

`src/errors/errors.ts` porting Ruby `lib/fontist/errors.rb`:

- Root `FontistError extends Error`.
- Formula: `FormulaNotFoundError`, `FormulaInvalidError`, `UnsupportedSchemaVersionError`,
  `MainRepoNotFoundError`.
- Font lookup: `FontError` base → `MissingFontError`, `ManualFontError`, `UnsupportedFontError`,
  `PlatformMismatchError`; `FontNotFoundError` (carries parsing errors).
- Install: `LicensingError`, `FontistVersionError`, `WindowsFodInstallError`,
  `UnsupportedMacOSVersionError`, `TranscodeLicenseNotAcceptedError`.
- Download: `InvalidResourceError`, `TamperedFileError`, `SizeLimitError`, `TimeoutError`.
- Font files: `FontFileError`, `FontIndexabilityValidationError`, `UnknownFontTypeError`,
  `UnknownArchiveError`, `FontExtractError`, `CollectionIndexError`.
- Infra: `RepoNotFoundError`, `RepoCouldNotBeUpdatedError`,
  `ManifestCouldNotBeFoundError`, `ManifestCouldNotBeReadError`, `FontconfigNotFoundError`,
  `FontconfigFileNotFoundError`, `FontIndexCorrupted`, `InvalidConfigAttributeError`,
  `BinaryCallError`, `UnsupportedTranscodeError`, `FormatNotAvailableError`.

## Acceptance

- Every error message matches its Ruby counterpart's intent; specs assert types + messages.
