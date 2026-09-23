# 44. Import core pipeline (metadata extraction, font files, detection, recursive extraction)

Status: DONE — implemented and verified this session.

Ported from `lib/fontist/import/`:

- `helpers/textHelper.ts` — `cleanup` (CRLF normalize, strip, drop leading
  blank lines, rstrip lines), `longestCommonPrefix` (>=2 chars, stripped).
- `helpers/hashHelper.ts` — `stringifyKeys` via JSON round-trip (Ruby
  `JSON.parse(to_json)`).
- `fontParsingErrorCollector.ts` — errors {path, message, backtrace},
  any/count/groupedErrors.
- `models/fontMetadata.ts` — FontMetadata serialization model (13 attrs) via
  the declarative framework.
- `fontMetadataExtractor.ts` — extract() from any font/collection (first face),
  cleaned version, font_format truetype/cff, is_variable; raises
  FontExtractError.
- `otf/fontFile.ts` — ImportFontFile (Ruby Otf::FontFile): toStyle /
  toCollectionStyle (snake_case keys, compact), name_prefix decoration,
  fallback family "Unknown"/type "Regular", homepage=vendor_url.
- `files/fontDetector.ts` — header-sniffing detect() → font|collection|other;
  standardExtension() preserving dfont/otc, collections→ttc, truetype→ttf,
  cff→otf; raises UnknownFontTypeError.
- `files/collectionFile.ts` — CollectionFile with per-face ImportFontFile list.
- `recursiveExtraction.ts` — recursive archive walk (our extractor registry),
  license matching (OFL/UFL/license/copying patterns), font candidate filter
  (extensions ttf otf ttc otc woff woff2 dfont, subdir + file pattern),
  dedup by family/type/version/filename, error collector.
- `src/fonts/dfont.ts` — minimal Mac resource-fork reader extracting `sfnt`
  resources so .dfont containers are readable (FontFile handles them).

Mirror specs: `spec/mirror/import_font_metadata_spec.ts`,
`spec/mirror/import_font_file_spec.ts`.
