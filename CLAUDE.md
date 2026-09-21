# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`fontist` (npm package, source repo `fontist/fontist-ts`) is the TypeScript port of the Ruby
Fontist gem (`../fontist` in a standard checkout, https://github.com/fontist/fontist). It
installs openly-licensed fonts and provides an API/CLI for managing fonts, driven by
**formulas** — YAML recipes in the `fontist/formulas` repo describing downloads, licenses,
and font metadata. It answers fontist/fontist#463 (TypeScript port) and #351 (npm support).

Reference semantics live in the Ruby gem. When behavior is unclear, the Ruby sources are the
spec: formula model (`lib/fontist/formula.rb`), installer (`font_installer.rb`), indexes
(`indexes/`), downloader (`utils/downloader.rb`, `utils/cache.rb`).

## Commands

```bash
npm install                     # Install dependencies
npm run build                   # Type-check + compile to dist/ (tsc)
npm test                        # Run all specs (vitest)
npx vitest run spec/formula.spec.ts          # Run a single spec file
npx vitest run -t "Formula model"            # Run tests matching a name
npm run lint                    # ESLint
npm run typecheck               # tsc --noEmit
node dist/cli.js install "Overpass"          # Run CLI from build
npm pack --dry-run              # Inspect package contents
```

CLI smoke test against the real formulas repo (downloads to `~/.fontist`):

```bash
FONTIST_PATH=/tmp/fontist-home node dist/cli.js update && \
FONTIST_PATH=/tmp/fontist-home node dist/cli.js install "Overpass" --accept-all-licenses
```

## Architecture

### Data flow (mirrors the Ruby gem)

CLI (`cli.ts`) or API (`Font` facade) → `FormulaRepository` finds formulas via the
**formula indexes** → `FontInstaller` downloads resources (cache + sha256 verify), extracts
archives, matches extracted files to formula styles → copies into an **install location**
(fontist/user/system) → the **installed-font indexes** record what is where.

### Layers (MECE)

- `src/serialization/` — declarative (de)serialization framework. Models declare
  `attributes` (type, default, collection) and a `keyValue` mapping (YAML key ↔ attribute,
  `childMappings`, polymorphic `type` tags). **All** model (de)serialization goes through it.
  Never hand-write `toYaml`/`fromJson` on a model — extend the framework instead
  (same rule as lutaml-model in the Ruby ecosystem).
- `src/formula/` — data models: `Formula`, `Resource`, `FontModel`, `FontCollection`,
  `FontStyle`, `Extract`, `ImportSource` hierarchy (macos/google/sil/windows). v4 formulas
  are `schema_version` absent; v5 is `schema_version: 5`. `FormulaRepository` is the lookup
  service (`find`, `findByKey`, `all`) over `~/.fontist/versions/v5/formulas/`.
- `src/index/` — two disjoint index families:
  - *Formula indexes* (`FormulaFontIndex` default/preferred-family, `FormulaFilenameIndex`):
    YAML maps `key → [formula paths]`, rebuilt from `FormulaRepository.all`.
  - *Installed-font indexes* (`FontistIndex`, `UserIndex`, `SystemIndex`): persist scanned
    font metadata (`SystemIndexFontCollection`) so lookups avoid re-parsing binaries.
- `src/fonts/sfnt/` — dependency-free SFNT/TTC parsing: magic-byte format detection,
  `name` table (family/subfamily/full/postscript/preferred names, ids 1/2/4/6/16/17),
  `fvar` (variable axes). `FontFile` is the facade over it.
- `src/extract/` — `ExtractorRegistry` keyed by detected archive format (OCP: add a format
  by registering an extractor, never by editing the pipeline). Zip and tar/gzip ship
  built-in; `Archive` performs recursive extraction of nested archives.
- `src/download/` — `Downloader` (fetch, retry w/ backoff, random browser header profiles,
  progress, sha256 verification, timeout config) and `DownloadCache`
  (`~/.fontist/downloads/map.yml`: URL → stored file, lockfile-guarded).
- `src/locations/` — install targets. `BaseLocation` contract (`installFont`, `uninstallFont`,
  `permissionWarning`); `FontistLocation` (`~/.fontist/fonts/{formula-key}`),
  `UserLocation`, `SystemLocation` (platform paths; macOS supplementary fonts go under
  `com_apple_MobileAsset_Font*` asset dirs). Created via `InstallLocation.create`.
- `src/installer/` — `FontInstaller` pipeline: platform → min-fontist-version → license
  gates, then resource installation. `ResourceInstallerRegistry` maps `formula.source`
  (`archive`/`google`/`apple_cdn`/`windows_fod`) to an installer.
- `src/system/` — OS detection (`FONTIST_PLATFORM_OVERRIDE` aware), font directory
  discovery per OS (`system-yml.ts` data), path scanning, exclusion list.
- `src/repo/` — git automation over the `git` binary: formulas repo shallow clone/update,
  private repo setup/update/remove, `Update` orchestration.
- `src/paths.ts` + `src/config/` — `FontistPaths` (all well-known paths:
  `~/.fontist/{fonts,downloads,versions/v5/...}`) and `Config` (config.yml + env overrides).
  `FontistContext` bundles them and is injectable in the API; a default singleton backs the CLI.

### Conventions

- All font/style name comparisons are case-insensitive (`equalsIgnoreCase`).
- All user-facing output goes through the `UI` module (`ui.say/error/debug/progress/ask`),
  never raw `console`.
- Formula keys are the relative formula path minus `.yml` (e.g. `macos/andale_mono`);
  name→key normalization is lowercase + spaces→underscores.
- Errors form a taxonomy under `src/errors/` rooted at `FontistError`; the CLI maps error
  classes to exit codes (`src/cli/exit_codes.ts`), mirroring the Ruby CLI constants.
- Paths in indexes/caches are stored relative to their root for relocatability.
- The formulas repo layout `versions/v5/formulas/Formulas/` must be preserved — formulas
  `key` derivation depends on it.

## ABSOLUTE RULES FOR THIS REPOSITORY

- **NEVER push tags.** The user decides when and what to tag.
- **NEVER commit to main, push to main, or merge to main locally.** All changes go through PRs.
- **NEVER add AI attribution** (Co-authored-by, "Generated with", etc.) to commits or PRs.
- **NEVER stage with `git add -A`/`git add .`** — stage explicit file paths only.
- **NEVER hand-roll serialization on models** — extend `src/serialization/` instead.
- **NEVER delete source files** (data files, fixtures, embedded YAML resources included).
