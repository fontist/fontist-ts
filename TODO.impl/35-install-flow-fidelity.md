Status: DONE — implemented and verified this session.

# 35 — Install-flow fidelity: suggestion choice, cache messaging, rename

Priority: 1

## Deliverable

Three remaining behavioral gaps against `font.rb` / `utils/downloader.rb` /
the font_spec examples:

- **Interactive formula choice** (Ruby `make_suggestions` → `offer_to_choose`):
  when installing by formula name fails to match, and the context is
  interactive, print `Formula 'X' not found. Did you mean?` with `[i] name`
  lines, ask `Please type number or press ENTER to skip installation:`,
  and install the chosen formula; ENTER/blank skips to the normal
  FormulaNotFoundError.
- **Cache-hit message**: the downloader announces `Using cached file.` when a
  resource is served from the download cache (font_spec "tells about
  fetching from cache").
- **source_font rename on install** (font_spec "detects, renames and installs
  the font"): when the archive contains the style's `source_font` name, the
  installed file uses the style's `font` name — exercised end-to-end via a
  formula whose source_font differs from font.
- Documented parity note: `FormatSpec.collectionIndex` is parsed and plumbed
  but unused downstream — exactly as in current Ruby (grep shows only
  CLI/manifest/format_spec references).

## Acceptance

- Spec: suggestion choice installs the picked formula (ui.ask answered "1");
  blank answer proceeds to FormulaNotFoundError.
- Spec: second force-install prints `Using cached file.`
- Spec: zip containing `X.old.ttf` (source_font) installs as `X.ttf` (font).
