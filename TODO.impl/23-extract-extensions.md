Status: DONE — implemented and verified this session.

# 23 — Extractor extensions (7z, cab, msi, exe-SFX, rpm, deb, xz, bz2)

Priority: 3 (registry + detection delivered; exotic codecs are follow-ups)

## Deliverable

- `ExtractorRegistry` ships zip + tar/gzip (see 8). This item delivers:
  - magic-byte detection coverage for 7z (`7z\xbc\xaf\x27\x1c`), cab (`MSCF`), msi
    (OLE CFB `\xd0\xcf\x11\xe0`), rpm (`\xed\xab\xee\xdb`), xz (`\xfd7zXZ`), bz2 (`BZh`),
    dmg (`koly` trailer) — so unknown formats produce precise
    `UnknownArchiveError` messages naming the detected format and the missing codec.
  - documented `Extractor` contract making each codec a self-contained class.
- `.exe` self-extracting archives: detect zip SFX (PK header at non-zero offset) and extract
  via zip with offset search.

## Acceptance

- Spec: detection table for every signature above; SFX-zip fixture extracts; non-SFX exe
  raises clear error.

## Future

- Native codecs: 7z (7z-wasm), cab/msi (libmspack wasm), rpm/deb/arc (libarchive wasm).
