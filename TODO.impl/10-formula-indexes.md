Status: DONE — implemented and verified this session.

# 10 — Formula indexes (font name / filename → formulas)

Priority: 1

## Deliverable

`src/index/formula/`:

- `formulaFontIndex.ts`: base class port of `IndexMixin` — YAML file
  (`formula_index.default_family.yml` / `.preferred_family.yml`): map
  `normalizedKey → [relative formula paths]`. `build(formulas)` (Map-backed, no O(n²)),
  `loadFormulas(key)` → Formula instances via repository, `fromFile` (auto-rebuild when
  missing), `rebuild`, `reset`. Subclasses choose the index key: default family
  (`style.defaultFamilyName || style.familyName`) vs preferred family
  (`style.preferredFamilyName || style.familyName`); keys lowercased.
- `formulaFilenameIndex.ts`: `filename_index.yml`, key = `style.font` (exact filename,
  not lowercased), same storage.
- `indexRegistry.ts`: picks default vs preferred by `config.preferred_family`;
  `rebuildAll(formulas)` rebuilds all three.

## Acceptance

- Spec builds indexes from fixture formulas; lookup by family name (case-insensitive), by
  preferred family, by filename; YAML file round-trip; auto-rebuild on missing file.
