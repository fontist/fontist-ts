# 46. V4 → V5 formula migrator

Status: DONE — implemented and verified this session.

Port of `lib/fontist/import/v4_to_v5_migrator.rb` → `src/import/v4ToV5Migrator.ts`:

- `migrateFile(path)` → `:migrated` | `:skipped`: adds `schema_version: 5`
  (front-inserted), upgrades resources (format detection from resource name /
  urls / files with font-extension whitelist; variable axes from
  `[a,b]` filename patterns), skips archive resources (zip/tar/gz/tgz/bz2/
  7z/rar/exe/cab extensions on name or urls/files), YAML-alias resolution via
  JSON round-trip, already-v5 + unchanged → skipped.
- `migrateAll()` → counts {migrated, skipped, failed, errors} over a file or
  directory (sorted `**/*.yml`), output path mapping (file→dir, dir→dir
  relative mapping), `dryRun` mode, verbose logging + summary.

Mirror spec: `spec/mirror/import_v4_to_v5_migrator_spec.ts`.
