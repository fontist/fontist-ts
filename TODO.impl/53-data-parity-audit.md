# 53. Deep-audit round 2: data-file parity (system.yml/exclude.yml)

Status: DONE — implemented and verified this session.

Fifth closure pass: **data-file parity**. The TS port embedded per-OS system
font directories derived from an OLDER Ruby `system.yml`; the current gem
data differs materially. Closed:

- **system.yml ported verbatim** into `src/system/systemFontsData.ts` as
  parsed patterns (glob prefix + per-line extension set):
  - macOS now scans `/Applications/Microsoft**/Contents/Resources/**`
    (ANY Microsoft app, not the hardcoded Word/PowerPoint/Excel/Sketch list),
    the unversioned MobileAsset glob
    `com_apple_MobileAsset_Font*/*.asset/AssetData` (future Font9 covered),
    and the FontServices PrivateFrameworks Subsets/ApplicationSupport dirs
    (replacing the stale `/System/Library/Fonts/FontServices/Supplemental`).
  - **Per-pattern extension filters** now mirror Ruby: macOS `/Library/Fonts`
    and `/System/Library/Fonts` are ttf/ttc-only, AssetsV2/FontServices add
    otf/otc, Windows dirs are ttf/otf/ttc/otc — previously every dir was
    scanned for all six extensions.
  - Windows paths aligned to the current file (`C:/Users/{username}/...`
    user fonts, `Program Files/Common Files/Microsoft/**`).
  - linux/unix aligned to `/usr/share/fonts` (ttf/ttc).
- **exclude.yml**: `Oriya Sangam MN.ttc` removed from the exclusion list
  (the current Ruby file excludes only `NISC18030.ttf`).
- **Scanning**: `scanFontTargets` (per-root extension filter) added next to
  `scanFontPaths`; SystemIndex, SystemFont.fontPaths, the validator, and the
  `index rebuild` CLI now scan with the pattern extension sets. Glob
  prefixes (`Microsoft**`, `Font*`, `*.asset`) are resolved against the
  filesystem before scanning.
- **Memoization**: expanded scan targets are cached process-wide with
  `resetSystemFontPathsCache()` — mirroring Ruby's
  `SystemFont.@system_font_paths ||=` memoization.
- **cache clear** additionally deletes
  `system_index.preferred_family.yml` (+ lock) per Ruby `clear_indexes`.

Not mirrored (noted): Ruby's `:unix` user_os (BSD/Solaris) maps to the linux
pattern set in TS via native platform detection; system.yml has a `unix` key
which TS keeps in the data table for completeness.

Verified non-gap: `system_preferred_family_index_path` exists in Ruby only
as a cache-cleanup target — the installed indexes are single-file
(default-family) in both implementations.

486 tests; all gates green.
