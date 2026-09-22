Status: DONE — implemented and verified this session.

# 33 — Installed-font index fidelity to Ruby semantics

Priority: 1

## Deliverable

Port `system_index.rb` exactly, correcting divergences introduced by the
first implementation:

- `find()` matches `family_name` (case-insensitive) and, when a style is
  given, `type` — never `full_name` or preferred names (Ruby find has no
  full-name matching; full names are only stored). Format-spec filtering
  applies after the name match; an empty result set returns null.
- `index_changed?` order: empty fonts → always changed; per-instance
  `indexCheckDone` flag (one unchanged verification short-circuits the rest
  of the session, `markVerified!` after loading a valid existing file);
  30-minute freshness; directory mtimes come from each index's *monitored
  directories* (config template base dirs + the index's own scan root),
  not from directories derived out of scanned font paths.
- `rebuild_with_lock`: exclusive `.lock` file around writes; after
  acquiring, re-read the on-disk index and adopt it wholesale when its
  `last_scan_time` is under 60 seconds (another process just rebuilt).
- `checkIndex`: required keys `path`/`full_name`/`family_name`/`type`
  (`file_size`/`file_mtime` optional) — `FontIndexCorrupted` with the
  missing-key message on load of a tampered file.
- Read-only mode (`readOnly`) skipping change detection, per Ruby's
  `read_only_mode` used by manifest compilation.
- Progress UX parity for large collections: "Building font index (N fonts
  found, this may take a while...)" before scans of >100 paths,
  "Scanning fonts: x/y..." during, "Font index built: N fonts indexed in Xs"
  after.
- Process-level caching parity: `SystemFont` memoizes its three index
  instances and a `find_styles` result cache with reset (Ruby Singleton +
  `@find_styles_cache`).

Documented deviation (kept): `addFont` inserts the single parsed entry
instead of Ruby's full forced rebuild — strictly less I/O with identical
result.

## Acceptance

- Specs: family-only matching (full name deliberately does NOT match),
  style filter, empty-index rebuild, tampered index → `FontIndexCorrupted`
  with missing-key message, lock adoption via a fresh `last_scan_time`
  (pre-seeded bogus entry survives a forced rebuild), read-only skip,
  memoized find_styles identity.
