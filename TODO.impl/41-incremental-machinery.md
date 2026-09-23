Status: DONE — implemented and verified this session.

# 41 — Port the incremental index machinery

Priority: 1

## Deliverable

The last un-ported local-font-indexing subsystem (Ruby
`indexes/{incremental_scanner,directory_snapshot,directory_change,
incremental_index_updater}.rb`, ~380 lines, 44 Ruby spec examples):

- `IncrementalScanner` (src/index/incremental/incrementalScanner.ts):
  `scanDirectory`, `scanFontFile` (path/filename/size/mtime/signature/
  format), `scanWithCache` (size+mtime reuse), `scanBatch`,
  `computeSignature` (sha256 of first 1KB), `detectFormat` (header magic:
  truetype/opentype/woff/woff2/unknown).
- `DirectorySnapshot`: immutable snapshot (create/fromHash), `fileInfo`,
  `hasFile?`, `olderThan?`, `fileCount`, `toObject`.
- `DirectoryChange`: added/modified/removed/unchanged factories, `diff`
  over two snapshots (size/mtime/signature comparison), query predicates,
  `toObject`.
- `IncrementalIndexUpdater`: per-directory updater with a snapshot store
  (Ruby uses Cache::Manager with a 300s TTL; TS uses a pluggable
  JSON-file/in-memory store), `update`/`addedFiles`/`modifiedFiles`/
  `removedFiles`/`changes?`/`stats`.

These classes are library surface in Ruby (available, spec-covered, not
wired into the main index flow) — the port mirrors that: exported API +
full spec coverage, main index flow unchanged.

## Acceptance

- `spec/mirror/incremental_index_spec.ts` ports the four Ruby specs'
  examples (added/modified/removed detection incl. same-size-mtime
  signature changes, cache reuse, TTL aging, empty/missing directories).
- Registry: the four `not-ported` entries become `mirrored`.
