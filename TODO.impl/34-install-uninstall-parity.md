Status: DONE — implemented and verified this session.

# 34 — Install/uninstall output and formula-lookup parity

Priority: 1

## Deliverable

- `FontPath` (Ruby `font_path.rb`): renders `- {path}` plus
  `(from {Formula A or Formula B} formula)` when the path is inside the
  fontist fonts directory, resolving formula names through the formula
  filename index; separator-normalized, case-sensitive on POSIX.
- `Font.all` returns the fonts (`FontModel[]`) across all platform-supported
  formulas — Ruby `all_formulas.map(&:fonts).flatten` — not the formulas.
- `FormulaRepository.findByFontFile(filePath)`: Ruby `Formula.find_by_font_file`
  via the formula filename index (first formula whose `style.font` basename
  matches).
- `find_system_font` prints paths through `FontPath`, matching Ruby's
  `find` output.

## Acceptance

- Specs: FontPath decoration inside/outside the fontist dir; `Font.all`
  shape; `findByFontFile` hit and miss; find output contains the
  `(from ... formula)` decoration for fontist-installed fonts.
