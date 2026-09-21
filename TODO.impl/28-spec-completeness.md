Status: DONE — implemented and verified this session.

# 28 — Spec completeness and dead-code removal

Priority: 2

## Deliverable

Close the coverage gaps left from session 1 and remove unused abstractions
(DRY/MECE audit):

- New specs: `FormulaSuggestion` (fuzzy ranking, stop words, downloadable
  filter), `userAgent`/`githubApiUrl` passthrough, `UI` (captured writers,
  progress suppression without TTY, ask via injected readline), fontconfig
  (fake `fc-cache` on PATH; missing-binary error), macos framework mapping,
  downloader progress + retry backoff boundaries.
- Remove `KeyedCollectionModel` from the serialization framework (unused
  since Manifest models root-mapped YAML explicitly; null-valued manifest
  entries do not fit it).
- Verify `SfntFont.isVariable`/`variableAxes` reuse table reads (no double
  parse) and that collection face indexes stay stable.

## Acceptance

- `npm test` green with the new spec files; `npm run lint` and
  `npm run typecheck` clean; no remaining references to removed symbols.
