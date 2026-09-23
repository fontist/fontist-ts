# 50. CLI closure audit — remaining commands and install flags

Status: DONE — implemented and verified this session.

Second audit pass over the CLI surface (`cli.rb` + all `*_cli.rb`) — the one
dimension the previous file-by-file audit had not enumerated command-by-command.
Found and closed:

- Top-level `rebuild-index` — formula index rebuild
  ("Formula index has been rebuilt."). Previously buried under our mis-scoped
  `fontist index`.
- `fontist index` re-scoped to the SYSTEM font index (Ruby IndexCLI):
  - `rebuild` (-v/--verbose, -o/--output): per-directory scan counts with
    "(fontist managed)" tags, totals, collection count, timings, index file
    save-for-inspection;
  - `path` — prints the system index file path;
  - `list` (--format yaml|json, --limit) — entries with path/family/full/
    subfamily/preferred names;
  - `clear` — deletes the index ("System font index cleared: <path>") or
    reports absence;
  - `update` — incremental check ("System font index updated" /
    "No changes detected", before/after counts, missing-index guidance).
  New accessors: `BaseFontCollectionIndex#existsOnDisk/entries/
  indexChangedNow`, `SystemIndexFontCollection#allFonts`,
  `SystemIndexFont#preferredSubfamilyName`.
- `migrate-formulas INPUT [OUTPUT]` (--verbose, --dry-run) over
  V4ToV5Migrator; failure exits 1 with "Migration completed with N error(s)",
  success prints "Migrated N formula(s), skipped M already v5 formula(s)".
- `create-formula URL` (--name, --mirror repeatable, --subdir,
  --file-pattern, --name-prefix, --schema-version default 5) over
  CreateFormula; prints "<file> formula has been successfully created".
- `macos-catalogs` — lists cached catalogs as "Font<N>: <path> (<size>)"
  with Ruby's empty-state hints and exit 1.
- Install flags added to match current Ruby: `--confirm-license` (ORed into
  acceptance), `--prefer-format <format>`, `--transcode-path <dir>`,
  `--keep-original` (default true); all flow through FormatSpec.

Verified non-gaps: `--macos-fonts-location` appears only in the Ruby error
text, not as a defined option (location is chosen via `--location fontist`);
Helpers#url_object is a legacy Ruby JSON-URL artifact (TS passes URL strings);
extract.rb is the formula Extract model (already ported).

Mirror coverage: spec/cli.spec.ts now mirrors the migrate-formulas /
create-formula / macos-catalogs / index flows of fontist/cli_spec.rb and
fontist/index_cli.rb behavior. 474 tests.
