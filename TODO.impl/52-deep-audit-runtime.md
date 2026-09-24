# 52. Deep-audit round: core runtime parity

Status: DONE — implemented and verified this session.

Fourth closure pass: method-level behavior diff of the core runtime classes
(cli.rb install/handle_error, config.rb, errors.rb, formula_picker.rb,
manifest_cli.rb, repo.rb, resource_collection, utils/system run_powershell).
Closed:

- **`FormulaNotFoundError` message**: now the full Ruby three-line text
  ("Formula 'x' not found locally nor available ... `fontist update` and try
  again") instead of the abbreviated round-1 text.
- **`FormatNotAvailableError` message**: Ruby-exact single-quote phrasing
  (`Format 'x' not available for font 'y'. Available formats: a, b`).
- **`CollectionIndexError`**: the out-of-range raise now carries Ruby's
  "Collection index N out of range. Valid range: 0-M" text.
- **Five missing error classes added**: FormulaIndexNotFoundError,
  MissingAttributeError, SourceNotFoundError (path),
  TranscodeToolNotFoundError (tool), VariableAxesNotSupportedError
  (font, axes) — completing the Ruby errors taxonomy.
- **CLI handle_error semantics**: `reportError` now mirrors
  `ERROR_TO_STATUS` — the table (status + :append/:overwrite message modes)
  is explicit; SizeLimitError appends the size-limit hint to the same line;
  manifest-not-found/read messages REPLACE the error text; the `Name: `
  prefix is gone. `exitCodeFor` unchanged (already at parity, including
  Ruby's duplicated 15 for FONTIST_VERSION_ERROR).
- **Install multi-font output**: multiple fonts now print Ruby's summary —
  "Successfully installed N font(s): a, b" and "Failed to install N font(s):"
  with per-failure "  - font: text" lines and first-failure exit status;
  single-font keeps the classic one-error path.
- **Manifest locations**: output switched from JSON to YAML
  (`print_yaml`) for both install and locations, and locations gained
  `-t/--show-timing` (resolution time + fonts-in-manifest lines).
- **resource_collection_spec** flipped to partial (v5 resources-map parsing
  plus Resource empty?/variable_font?/axes semantics covered by formula-model
  specs). **run_powershell_spec** flipped to mirrored (default runner ENOENT →
  unsuccessful result; injected runner propagation).

Final mirror registry: 44 mirrored / 47 partial / 4 not-ported — the 4 are
verified Ruby-only infrastructure (cache manager/store, memoizable,
file_ops, formulas_isolation). 483 tests; all gates green.
