Status: DONE — implemented and verified this session.

# 25 — Native archive extractors (7z) and windows_fod install path

Priority: 2

## Deliverable

Completes the "Future" codec items of TODO 23 and the practical FOD gap of
TODO 21, using the same strategy as the Ruby gem (excavate delegated exotic
containers to 7-Zip):

- `src/extract/processExtractor.ts`: `ProcessExtractor` adapter that
  delegates extraction to a system binary (`7z` / `7zz`, resolved via PATH).
  Registered for 7z, cab, msi and exe-SFX signatures — the containers that
  the pure-JS extractors cannot handle. Missing binary → descriptive
  `UnknownArchiveError` at lookup time, never a silent failure.
- `ResourceInstallerRegistry`: `windows_fod` installer downloads the FOD
  resource URLs and extracts them like any archive payload (replacing the
  hard `WindowsFodInstallError` stub); errors remain typed for platforms
  without the payloads.

## Acceptance

- Specs (conditional on 7z availability, present on dev machines and CI
  images can install p7zip): extract a 7z archive and a cab fixture built
  with the real binary; exe-SFX detection names the 7z path.
- Registry spec: windows_fod resolves the download+extract installer;
  unknown source still raises.
