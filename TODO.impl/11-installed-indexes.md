Status: DONE — implemented and verified this session.

# 11 — Installed-font indexes

Priority: 1

## Deliverable

`src/index/installed/`:

- `systemIndexFont.ts` model: path (relative to index root), fullName, familyName,
  subfamily (YAML key `type`), preferredFamilyName, preferredSubfamilyName, fileSize,
  fileMtime; collection wrapper `SystemIndexFontCollection` with `lastScanTime` +
  `directoryMtimes` bookkeeping.
- `baseFontCollectionIndex.ts`: shared behavior — persistent YAML at its `indexPath`,
  lazy load (auto-build when file missing), `find(name, style?)` case-insensitive on
  family/full-name/subfamily, `addFont(path)` (parse via FontFile, update index,
  atomic write), `removeFont(path)`, `rebuild(force)` with mtime short-circuit
  (skip re-scan when directory mtimes unchanged and scan < 30 min old), per-file
  size+mtime reuse of previous entries, corrupt files warned and skipped.
- Concrete: `FontistIndex` (scans `~/.fontist/fonts/**`), `UserIndex` (UserLocation path),
  `SystemIndex` (SystemFont.fontPaths). All context-injected, no singletons in library code.

## Acceptance

- Specs: build from fixture fonts, find by family/style, add/remove font updates YAML,
  rebuild short-circuits when mtimes unchanged (scan count assertion), corrupt font skipped.
