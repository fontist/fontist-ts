Status: DONE — implemented and verified this session.

# 30 — Installer and CLI coverage gaps

Priority: 2

## Deliverable

Close the untested paths found in the coverage sweep:

- Google resource installer end to end: `source: google` formula whose
  `files:` URLs are matched by source filename and downloaded individually
  (local HTTP server), covering the v5 google fallback in `sourceFiles`.
- Apple CDN installer platform gate: raises `UnsupportedMacOSVersionError`
  off macOS, proceeds on macOS (fixture platform injection).
- Manual formulas: `Font.find`/`Font.install` on a formula without resources
  raises `ManualFontError` with the instructions text.
- CLI `install <key> -F` formula-mode: installs a whole formula by key.
- Manifest locate honoring a `format:` entry (positive and filtered-out
  cases via the FormatMatcher integration).
- CLI `--size-limit` rejects non-numeric input instead of propagating NaN
  into the picker.

## Acceptance

- New specs for each; full suite green; no production behavior change except
  the NaN guard.
