Status: DONE — implemented and verified this session.

# 37 — Collection multi-face indexing and error-output parity

Priority: 1

## Deliverable

Two real gaps found by re-reading `system_index.rb`:

- **Multi-face collection indexing** (Ruby `detect_collection_fonts`): a
  .ttc/.otc contributes one index entry **per face** (same path, per-face
  family/subfamily/full/preferred names; shared file size/mtime). The
  current port indexes only face 0, so non-first faces of installed or
  system collections are unfindable and ununinstallable by name. Faces with
  incomplete metadata are skipped individually (Ruby parse_font → nil).
  Scan-time cache reuse groups previous entries by path: an unchanged
  (size, mtime) file reuses all its face entries.
- **Error-output levels and texts** (Ruby print_recognition_error /
  warn_incomplete_metadata / print_validation_error):
  - unrecognized file → `ui.error`: `Warning: File at {path} not recognized
    as a font file.` (with the exception summary line);
  - incomplete name records → `ui.error`: `Skipping font with incomplete
    metadata: {path}` + `Missing attributes: full_name, family_name.` +
    `This font will not be indexed, but Fontist will continue to work.`;
  - parse/validation failure → `ui.debug`: `Skipping corrupt/invalid font:
    {basename}` + `Validation failed: {message}`.

## Acceptance

- Spec: a two-face TTC yields two entries (both families findable at the
  same path); unchanged files reuse all face entries on rescan.
- Spec: uninstalling by the *second* face's family name removes the file.
- Spec: unrecognized file produces the error-level "not recognized" message
  without raising; incomplete-metadata font produces the exact Ruby text.
