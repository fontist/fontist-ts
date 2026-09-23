# 47. Google Fonts import stack

Status: DONE — implemented and verified this session.

Port of `lib/fontist/import/google/` → `src/import/google/`:

- `models/` — Axis, FontFamily (files as hash attribute + JSON/`=>` string
  fallback parsing, axis query helpers), FontVariant, Metadata,
  FontFileMetadata, AxisMetadata, SourceMetadata, FileMetadata — all via the
  declarative serialization framework (new `hash` scalar type added to the
  framework for raw-object attributes).
- `textproto.ts` — protobuf text-format parser (strings, ints, floats, bools,
  nested/repeated messages, comments) producing a field tree.
- `metadataAdapter.ts` — adapts the parsed textproto tree into the plain hash
  shape consumed by `Metadata` (fonts, axes, source, files,
  registry_default_overrides, is_noto, languages, primary_script).
- `dataSources/base.ts` (+ `ttf`/`vf`/`woff2`) — Google Fonts Webfonts API
  clients with injectable base URL (hermetic tests via local HTTP server),
  capability parameter, memoized fetch, FontFamily parsing.
- `dataSources/github.ts` — local google/fonts checkout reader: METADATA.pb
  via textproto+adapter, font files via ImportFontFile, license text/homepage,
  DESCRIPTION.en_us.html tag-stripping, category/license normalization,
  variant names from weight+style.
- `fontDatabase.ts` — merge of TTF/VF/WOFF2 endpoints + GitHub index, v4
  (skips variable fonts) vs v5, format file maps, formula generation via the
  versioned builders, import_source from repo commit (`git rev-parse`), YAML
  output with stringified keys.
- `formulaBuilders/` — BaseFormulaBuilder, FormulaBuilderV4 (TTF-only,
  static-only, downloads fonts through ctx Downloader and extracts full
  metadata), FormulaBuilderV5 (TTF+WOFF2, variable + static resources,
  per-style formats/variable_font/variable_axes).
- `api.ts` — Api facade (items/fontByName/byCategory/variableFontsOnly/
  staticFontsOnly/fontsCount/raw endpoint access/clearCache) with injectable
  API key + base URL.

Ruby-only dependencies not ported: `unibuf` (replaced by textproto.ts),
`MetadataParser` regex parser (no spec, superseded by the adapter path).

Mirror specs: `spec/mirror/import_google_models_spec.ts`,
`spec/mirror/import_google_metadata_adapter_spec.ts`,
`spec/mirror/import_google_data_sources_spec.ts`,
`spec/mirror/import_google_font_database_spec.ts`.
Fixtures: google_fonts METADATA.pb files + API JSON responses copied from the
Ruby spec fixtures.
