Status: DONE — implemented and verified this session.

# 14 — Installer pipeline and formula selection

Priority: 1

## Deliverable

- `src/formula/formatSpec.ts`: `FormatSpec` (format, variableAxes, preferVariable,
  preferFormat, transcodePath, keepOriginal, collectionIndex) + `fromOptions` parsing.
- `src/formula/formatMatcher.ts`: DESKTOP vs WEB format sets; `matchesResource`,
  `matchesStyle`, `selectPreferredResource`, `canConvert` (desktop→web only),
  `installationStrategy` (install | convert{from,to} | unavailable).
- `src/formula/formulaPicker.ts`: filters — style version equality, size limit (300 MB
  default, bypass when resources fully cached; `SizeLimitError`), min_fontist
  (`FontistVersionError`), format-spec matching (v4 passthrough; `FormatNotAvailableError`).
  `choose`: differing style-type sets → all; else max style version then smallest file size.
- `src/formula/formulaSuggestion.ts`: fuzzy match over formula keys (dice coefficient +
  Levenshtein, stop-word namespace prefixes, threshold 0.6, top 10, downloadable only).
- `src/installer/resourceInstallers.ts`: `ResourceInstaller` interface + registry keyed by
  `formula.source`; `ArchiveResourceInstaller` (urls in order, collect
  `InvalidResourceError`s), `GoogleResourceInstaller` (resource.files URLs); registry
  entries for apple_cdn/windows_fod raising clear "not yet supported on this platform"
  errors (`WindowsFodInstallError`, `UnsupportedMacOSVersionError` respectively).
- `src/installer/fontInstaller.ts`: port of Ruby `FontInstaller` — gates: platform
  (`PlatformMismatchError`), min_fontist (`FontistVersionError`), license (confirmation
  "yes" case-insensitive; `LicensingError`); resource selection (format-spec preferred →
  desktop-format resource → first); extract recursively; match extracted files to styles
  (sourceNames from styles filtered by fontName; `fontsSubDir` fnmatch-style filter);
  install per file into location with rename `sourceFont||font → font`; returns installed
  paths array. Transcode path: detect need, `TranscodeLicenseNotAcceptedError` gate, then
  `UnsupportedTranscodeError` (web conversion is a documented extension point).

## Acceptance

- Specs with fixture formula + local HTTP file server + zip fixture: full install into
  tmp fontist location; gates raise correct errors; style matching incl. fontsSubDir;
  rename-on-install; format filtering.
