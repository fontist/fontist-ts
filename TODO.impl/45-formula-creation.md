# 45. Formula creation pipeline (FormulaBuilder, CreateFormula, ManualFormulaBuilder)

Status: DONE — implemented and verified this session.

Ported from `create_formula.rb`, `formula_builder.rb`, `manual_formula_builder.rb`:

- `formulaBuilder.ts` — FormulaBuilder: FORMULA_ATTRIBUTE order (schema_version,
  name, platforms, description, homepage, resources, font_collections, fonts,
  extract, copyright, license_url, requires_license_agreement, open_license,
  digest, command, import_source, font_version); name from options or
  family/style common prefix; deep_compact; collections sorted by filename,
  fonts by name, styles by type; open-license warnings ("WARN: please add
  license manually", "WARN: ensure it's an open license, ..."); filename
  generation with import_source differentiation keys (`name_key.yml`);
  `keepExisting` guard returns existing path untouched; YAML dump with
  stringified keys. ManualFormulaBuilder attribute-order variant.
- `createFormula.ts` — CreateFormula: local-file or download (ctx Downloader),
  mirrors downloaded with exact WARN messages ("WARN: a mirror is not found
  'URL'", "WARN: SHA256 differs (a, b)" with uniq list), sha256 single-or-array,
  file_size, v5 format + variable_axes detection from font files
  (extension map + `[axes]` filename pattern), RecursiveExtraction with
  subdir/filePattern/namePrefix/verbose.

Legacy Ruby-only helpers NOT ported (no specs, not used by the import CLI):
FormulaSerializer, TemplateHelper, ConvertFormulas, UpgradeFormulas —
formulas-repo maintenance tooling. Documented as Future.

Mirror spec: `spec/mirror/import_create_formula_spec.ts` (synthetic archives:
zip of TTFs + license, zip with TTC collection, file_pattern filter, subdir
filter, mirror warnings, keep-existing/override).
