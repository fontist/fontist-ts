Status: DONE — implemented and verified this session.

# 8 — Archive extraction

Priority: 1

## Deliverable

`src/extract/`:

- `extractor.ts`: `Extractor` interface `{ formatId, canExtract(magic): boolean,
  extract(archivePath, destDir): Promise<string[]> }` and `ExtractorRegistry`
  (ordered; OCP — new formats register, pipeline never edits).
- `zipExtractor.ts`: yauzl-based streaming extraction incl. nested paths; sanitized entry
  names (no `..` escapes).
- `tarExtractor.ts`: `.tar`, `.tar.gz`, `.tgz` via `tar` package (x mode, gzip via zlib).
- `archive.ts`: `Archive.extractAll(dest, { recursivePackages: true })` — sniff magic bytes
  (not extension), extract, then for each extracted file re-sniff and recurse into known
  archives; unknown-but-sniffed formats raise `UnknownArchiveError` with format name;
  returns flat list of extracted file paths.
- `magic.ts` shared byte-sniffing helpers (zip PK\x03\x04, gzip \x1f\x8b, tar at offset 257
  `ustar`, etc.).

## Acceptance

- Fixtures: zip with nested zip with font, tar.gz with font. Extraction yields expected
  relative paths; path traversal entries rejected; unknown format error is clear.
