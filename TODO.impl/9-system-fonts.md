Status: DONE — implemented and verified this session.

# 9 — System fonts, OS detection, scanning

Priority: 1

## Deliverable

`src/system/`:

- `systemInfo.ts`: `userOs()` → `macos | linux | windows` (with `FONTIST_PLATFORM_OVERRIDE`
  parsing `macos-font<N>|linux|windows`); `matchesPlatform(formulaPlatforms)` (exact or
  `os-` prefixed entries); `currentOsVersion()` (macOS `sw_vers` major, others generic).
- `systemFontsData.ts`: embedded `system.yml` port — per-OS search patterns:
  linux `/usr/share/fonts/**`, windows font dirs + LOCALAPPDATA + Program Files common,
  macos `/Library/Fonts`, `/System/Library/Fonts`, `~/Library/Fonts`, MS Office app bundles,
  MobileAsset `AssetsV2/com_apple_MobileAsset_Font*/*.asset/AssetData`,
  FontServices subsets; `{username}` substitution; embedded `exclude.yml` filename list.
- `pathScanning.ts`: recursive scan of pattern dirs filtered by font extensions
  (ttf/otf/ttc/otc/dfont/woff/woff2), permission errors swallowed, case-insensitive ext
  matching on all platforms.
- `systemFont.ts`: `SystemFont.find(name)` (via SystemIndex/UserIndex/FontistIndex merge,
  dedupe by path), `fontPaths()`, `findStyles(name, style?)` with FormatMatcher filter.

## Acceptance

- Specs with fixture font dirs: pattern substitution, extension filtering, exclusion list,
  find across the three indexes with dedupe.
