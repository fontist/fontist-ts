Status: DONE — implemented and verified this session.

# 38 — Mirror deepening: collections, recognition errors, CLI outputs

Priority: 2

## Deliverable

Port the remaining collection- and error-related Ruby examples into the
mirror suite:

- system_index_spec.rb: "indexes all fonts from the collection based on
  magic bytes" (both faces), "prints a recognition error without raising"
  (exact message), "filters out fonts with incomplete metadata" (exact
  message), "does not raise errors" for preferred/default family scans.
- font_spec.rb: "returns path of collection file" — install a formula with
  `font_collections` whose archive contains a real TTC; uninstall by a
  non-first face family name.
- cli_spec.rb: `uninstall` for a collection face; `status` output listing.
- Registry notes updated for the widened system_index/font_spec coverage.

## Acceptance

- New examples pass hermetically; `npm run mirror:check` and the full suite
  stay green.
