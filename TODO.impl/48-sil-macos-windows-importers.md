# 48. SIL, macOS, and Windows importers + import CLI

Status: DONE — implemented and verified this session.

- `src/import/helpers/htmlWalk.ts` — minimal HTML subset parser (tag tree with
  class chains + anchor records) powering the CSS-selector-ish lookups the
  importers need (`table.products div.title > a`, `a.btn-download`,
  `a.getfile`, text matching). No DOM dependency.
- `src/import/silImporter.ts` — SilImporter port: products-page scrape
  (injectable fetch + random user agent), index-page filter, name filter,
  version extraction from archive URLs, SilImportSource creation, formula
  creation via CreateFormula (OFL-1.1 open license, keep-existing unless
  --force), results {successful, failed, skipped, overwritten, errors,
  duration}, verbose display.
- `src/import/macos/catalog/` — Asset/FontInfo, BaseParser (plist parsing via
  the `plist` package; postedDate → ISO), Font3–Font8 parsers (Font8 filters
  assets by asset-level PlatformDelivery), CatalogManager (catalog URLs,
  cache dir under versionsPath/macos_catalogs, injectable download,
  version detection from path, parser selection).
- `src/import/macos/macosImporter.ts` — MacosImporter port: asset filtering,
  per-asset CreateFormula with MacosImportSource, versioned formula dirs
  (macos/font3..font8), macos-font<N> platforms, Apple license text, summary +
  failure report.
- `src/import/windows/` — WindowsFodMetadata (fod_capabilities.yml data file
  bundled; reverse font→capability map, resettable cache) and the Windows
  formula generator (schema_version 5, windows_fod resources, import_source
  type windows, bundled Windows license text).
- `src/import/importDisplay.ts` — plain-text port of ImportDisplay (header,
  progress, page/download URLs, errors).
- CLI: `fontist import google|macos|sil` with option parity to
  `import_cli.rb` (source_path/plist/output_path/font_name/font_family/force/
  verbose/import_cache/schema_version), summary lines "Import completed /
  Successful: N / Skipped: N / Overwritten: N / Failed: N / Duration";
  `paths.importCachePath()` honoring FONTIST_IMPORT_CACHE;
  google_fonts_key from config or GOOGLE_FONTS_API_KEY.

Data files bundled from the Ruby gem (same project, MIT): fod_capabilities.yml,
macos_license.txt, windows_license.txt.

Mirror specs: `spec/mirror/import_sil_spec.ts`,
`spec/mirror/import_macos_catalog_spec.ts`,
`spec/mirror/import_macos_dfont_spec.ts`, `spec/mirror/import_windows_spec.ts`.
macos_ondemand_fonts_spec / windows_ondemand_fonts_spec are install-flow
platform gating — already covered (partial) by existing formula/installer
specs; registry notes updated.
