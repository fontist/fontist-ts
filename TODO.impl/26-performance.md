Status: DONE — implemented and verified this session.

# 26 — Performance: formula memoization and bounded parallelism

Priority: 2

## Deliverable

- `src/util/concurrency.ts`: `mapWithConcurrency(items, limit, fn)` helper
  (no new dependency).
- `FormulaRepository`: memoize `all()` / `allKeys()` per instance with
  `invalidate()`; `FormulaIndexRegistry.rebuildAll` therefore parses the
  formulas tree once. YAML parsing runs with bounded concurrency.
- `BaseFontCollectionIndex.rebuild`: parse fonts with bounded concurrency
  (mirror of Ruby's capped thread pool) while preserving deterministic
  output order (sort after parallel map).
- Layering cleanup: remove genuinely dead exports found by usage scan
  (macosFramework async helpers superseded by the sync formula-derived
  path; unused fsx path wrappers).

## Acceptance

- Specs: repository memoization returns identical results and reflects
  `invalidate()`; parallel rebuild produces the same index as sequential
  (golden comparison); output order stable.
- Manual benchmark note: `fontist index rebuild` against the real
  formulas repo completes noticeably faster than serial (observation, not a
  hard gate).
