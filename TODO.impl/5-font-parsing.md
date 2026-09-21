Status: DONE — implemented and verified this session.

# 5 — Font binary parsing (SFNT/TTC)

Priority: 1

## Deliverable

`src/fonts/sfnt/` (dependency-free, replaces Ruby's fontisan for metadata needs):

- `magic.ts`: detect `ttf` (\x00\x01\x00\x00), `otf` (OTTO), `ttc` (ttcf), `otc` (ttcf),
  `woff` (wOFF), `woff2` (wOF2) from bytes; `isCollection()`.
- `nameTable.ts`: parse `name` table format 0: records {platformId, encodingId, languageId,
  nameId, value}; decode UTF-16BE (platform 0/3) and Mac Roman (platform 1, ASCII subset +
  Latin-1 fallback) via TextDecoder/manual table; `englishName(id)` resolution order
  (Windows en-US → Unicode English → any English → any, matching fontisan semantics).
- `sfntFont.ts`: read table directory lazily; expose `fullName(4)`, `familyName(1)`,
  `subfamilyName(2)`, `postScriptName(6)`, `preferredFamilyName(16)`,
  `preferredSubfamilyName(17)`, `version(5)`, `isVariable()` (fvar present),
  `variableAxes()` (fvar axis tags).
- `collection.ts`: `ttcf` header (version, count, offsets) → per-index `SfntFont` readers.
- `src/fonts/fontFile.ts`: `FontFile.fromPath(path)` facade → { format, familyName,
  subfamilyName, fullName, postScriptName, preferredFamilyName, preferredSubfamilyName,
  version, isVariable, variableAxes } handling collections (index 0 or requested index),
  extension/content mismatch warning via UI. Corrupt files raise `FontFileError`.

## Acceptance

- Spec fixtures: a small TTF, an OTF, a TTC with 2 faces. Name extraction verified against
  known values. Magic detection table-driven spec.
