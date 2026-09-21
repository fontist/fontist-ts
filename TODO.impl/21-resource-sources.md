Status: DONE — implemented and verified this session.

# 21 — Resource installer extension points (apple_cdn, windows_fod)

Priority: 3 (registry entries are delivered; full platform features are follow-ups)

## Deliverable

- `ResourceInstallerRegistry` ships `archive` + `google` fully working (see 14) and registers
  `apple_cdn` and `windows_fod` implementations:
  - `apple_cdn`: downloads resource URLs from Apple's CDN (plain URL download — same as
    archive path but no nested-package recursion needed beyond standard extract), installs
    into the macOS framework asset path via SystemLocation.
  - `windows_fod`: downloads the FOD resource URLs; metadata (`capabilityName`) carried
    through; license/packaging constraints unsupported → `WindowsFodInstallError` with
    explanation rather than silent failure.
- Registry is the only extension point: adding a source = new installer class + registration.

## Acceptance

- Spec: registry resolves the right installer per `formula.source`; unknown source →
  `InvalidResourceError`.

## Future (out of scope, documented here)

- Full MobileAsset catalog querying (macos/catalog/* Ruby port) to auto-discover asset URLs.
- Windows FOD payload assembly (PowerShell/cab pipeline).
