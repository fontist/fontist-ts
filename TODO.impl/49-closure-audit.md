# 49. Closure audit — final parity gaps

Status: DONE — implemented and verified this session.

File-by-file audit of all 158 Ruby `lib/fontist/**/*.rb` files against the TS
port. Most already mapped; this round closes the genuinely missing runtime
behavior:

- `src/system/systemUtils.ts` — full port of Ruby `Utils::System`:
  platform-override parsing that KEEPS the framework number
  (`macos-font7` → `{os: macos, framework: 7}`), `userOs`, `macosVersion`
  (`sw_vers -productVersion`; override+framework maps to the framework's
  min macOS version), `parseMacosVersion` (major*10000+minor*100+patch),
  `versionInRange`, `catalogVersionForMacos` (override framework, else
  `MacosFrameworkMetadata.frameworkForMacos`), `userOsWithVersion`/`match`,
  and `runPowershell` (`powershell.exe -NoProfile -NonInteractive -Command`,
  ENOENT → unsuccessful result). Injectable command runner for hermetic tests.
- Errors aligned to Ruby messages: `UnsupportedMacOSVersionError(detected,
  frameworks)` with the full supported-frameworks/override-options text, and
  `WindowsFodInstallError(capabilityName, stderr)` with the
  possible-causes appendix.
- `Formula`: `compatibleWithPlatform` now performs Ruby's macOS framework
  check for macos-import formulas (raises UnsupportedMacOSVersionError when
  the current macOS version maps to no framework); adds
  `compatibleWithCurrentPlatform` and `platformRestrictionMessage`.
- `WindowsFodResourceInstaller` rewritten to Ruby `WindowsFodResource`
  semantics: capability state via `Get-WindowsCapability` (skip when
  `Installed`), install via `Add-WindowsCapability` with PowerShell
  single-quote escaping, then yield fonts found in `%windir%/Fonts`;
  raises `WindowsFodInstallError` on failure. (The previous TS version
  wrongly downloaded a payload archive.)
- `MacosImportLocation`/framework resolution: non-import macOS supplementary
  formulas fall back to `catalogVersionForMacos` (Ruby
  `SystemLocation#framework_version`).

Deliberately skipped (verified dead/infra in Ruby):
`FontInstaller#macos_asset_directory` (no callers; SystemLocation owns the
path), `cache/manager` + `cache/store` + `memoizable` (TTL/memoization infra,
covered by explicit memoization), `utils/file_ops` (unzip helper superseded by
the extractor registry), `run_powershell` itself now ported (see above),
`formulas_isolation` (autoload bootstrap), import-side
FormulaSerializer/TemplateHelper/ConvertFormulas/UpgradeFormulas
(formulas-repo maintenance, no specs).

Mirror spec: `spec/mirror/platform_gating_spec.ts` now mirrors
spec/fontist/macos_ondemand_fonts_spec.rb and
spec/fontist/windows_ondemand_fonts_spec.rb (platform gating, error messages,
FOD resource dispatch with an injected PowerShell runner).
