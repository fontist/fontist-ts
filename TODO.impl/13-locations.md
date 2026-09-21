Status: DONE — implemented and verified this session.

# 13 — Install locations

Priority: 1

## Deliverable

`src/locations/`:

- `installLocation.ts`: `InstallLocationType = fontist | user | system`;
  `createInstallLocation(type, ctx, formula?)` factory (config/ENV `fonts_install_location`
  default); `allLocations(ctx)`.
- `baseLocation.ts`: contract — `basePath`, `locationType`, `installFont(sourcePath,
  targetName)`, `uninstallFont(filename)`, `isManagedPath`, `permissionWarning`,
  `requiresElevatedPermissions`; shared logic: exists → managed replace / unmanaged unique
  name (`X-fontist.ttf`, `-2`, …) + duplicate warning; else mkdirp + copy + index.addFont.
- `fontistLocation.ts`: `fonts/{formula.key}`; managed; FontistIndex.
- `userLocation.ts`: config `user_fonts_path` (ENV override) else platform default + `/fontist`
  (macOS `~/Library/Fonts`, linux `~/.local/share/fonts`, win `%LOCALAPPDATA%/.../Fonts`);
  managed iff default path or `/fontist` suffix.
- `systemLocation.ts`: config `system_fonts_path` else macOS `/Library/Fonts/fontist`,
  linux `/usr/local/share/fonts/fontist`, win `%windir%/Fonts/fontist`; macOS supplementary
  (import) fonts → `com_apple_MobileAsset_Font{N}/{prefix}.asset/AssetData/` with
  framework version detection; always elevated + permission warning text.
- `macosFramework.ts`: framework version → MobileAsset dir resolution
  (`MacosFrameworkMetadata` port), errors as `GeneralError`.

## Acceptance

- Specs per location (tmp dirs): install/copy, replace, unique-name fallback, uninstall,
  path computation per simulated OS (override via injection, not env hack), permission
  warnings present for system location.
