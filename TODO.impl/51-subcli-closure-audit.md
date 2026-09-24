# 51. Sub-CLI + class-options closure audit

Status: DONE — implemented and verified this session.

Third closure pass: command-by-command diff of the five sub-CLI modules
(cache_cli, config_cli, fontconfig_cli, repo_cli, manifest_cli) plus
`cli/class_options.rb`, and attribute-level diff of the formula-model family
(font_style/font_model/font_collection/collection_file/font_file). Closed:

- **Shared class options** (Ruby CLI::ClassOptions): `-q/--quiet`,
  `-c/--no-cache`, `--preferred-family`, `-i/--interactive`,
  `--formulas-path <path>` registered on the program and threaded through a
  new `FontistContext.runtime` ({quiet, useCache, preferredFamily,
  interactive}). Commander keeps program options off subcommand flags, so
  runCli captures them in a `preAction` hook and withContext merges them.
  Wiring: quiet → UI `fatal` level (say/error/warn/progress suppressed);
  no-cache → Downloader default useCache; preferred-family → in-memory
  Config runtime override consumed by FormulaIndexRegistry; formulas-path →
  FontistPaths formulasDirOverride.
- **cache CLI**: added `clear-import` (-v) and `info` (download + import
  cache location/size/files with format_size); `clear` now also deletes the
  system index file and its lock (Ruby clear_indexes). `path` kept as a
  TS extra.
- **config CLI**: added `show` ("Config is empty." / YAML dump) and `keys`
  (all known keys with defaults). Config gained `defaultValues()`,
  `defaultValue(key)`, `setRuntimeOverride()`.
- **fontconfig CLI**: added `remove` (-f) backed by a new
  `Fontconfig.remove` (delete 10-fontist.conf under XDG config, best-effort
  fc-cache refresh first, FontconfigFileNotFoundError unless forced); the
  fc-cache runner was extracted and is shared with `update`.
- **Formula models**: FontStyle confirmed at full attribute parity (18 attrs
  incl. default_family/override/formats/variable_*/source_resource).
  CollectionFile/FontFile semantics re-checked against the installer.
- **Indexing**: ported FontFile.check_extension_warning — the three
  content/extension mismatch WARNINGs (collection-in-wrong-extension,
  single-font-with-collection-extension, wrong-format-extension) plus the
  debug fallback, emitted during index scans.

479 tests; all gates green (lint, typecheck, build, mirror check).
