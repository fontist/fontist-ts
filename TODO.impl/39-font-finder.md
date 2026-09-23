Status: DONE — implemented and verified this session.

# 39 — FontFinder and the `fontist find` command

Priority: 1

## Deliverable

Ports the un-ported formula-functionality surface (Ruby `font_finder.rb` +
the `find` CLI command + `Formula.find_fonts`/`find_styles`):

- `src/formula/fontFinder.ts`: `FontFinder` over all platform-supported
  formulas —
  - `byAxes(axes)`: v5 formulas whose resources are variable and support
    ALL requested axes;
  - `variableFonts()`: all v5 variable resources;
  - `byCategory(category)`: name-heuristic categories (mono → monospace,
    sans-serif, serif, default sans-serif — Ruby's documented heuristic);
  - optional `formatSpec` filtering via FormatMatcher;
  - `FontMatch` result objects (`toObject()` mirrors Ruby `to_h` with
    compacted keys).
- `FormulaRepository.findFonts(name)` and `.findStyles(name, style)`
  (Ruby `Formula.find_fonts`/`find_styles`): case-insensitive font/style
  selection across the font index.
- CLI `fontist find` with `--axes`, `--variable`, `--category`, `--format`,
  `--json`; no selector → error "Please specify --axes, --variable, or
  --category" (exit 1), mirroring Ruby.

## Acceptance

- Specs: byAxes (subset/all-of semantics), variableFonts, category
  heuristic, format filter, findFonts/findStyles, JSON output shape, and
  the no-selector error.
- Registry: `font_finder_spec.rb` gains a TS mirror.
