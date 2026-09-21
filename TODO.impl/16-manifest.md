Status: DONE — implemented and verified this session.

# 16 — Manifest

Priority: 2

## Deliverable

`src/api/manifest.ts`:

- Models via serialization framework: `Manifest` (map name → {styles[], format?,
  variableAxes?, preferVariable?, transcodePath?, keepOriginal?, collectionIndex?}),
  `ManifestResponse` (name → styles [{type, fullName, paths}]).
- `Manifest.fromFile(path, ctx)` (`ManifestCouldNotBeFoundError` /
  `ManifestCouldNotBeReadError` on missing/empty/invalid YAML).
- `locateFonts(manifest, {locations})`: find styles via SystemFont.findStyles;
  missing + `locations:true` → `MissingFontError`; build response grouped by style type
  with full_name + paths.
- `installFonts(manifest, {confirmation, hideLicenses, noProgress, location})`:
  platform pre-check (all formulas compatible, else `PlatformMismatchError`), then
  force-install each entry with its FormatSpec.

## Acceptance

- Specs: fixture manifest YAML (string + object forms), locate hit/miss, install flow with
  fixture formulas, response shape.
