Status: DONE — implemented and verified this session.

# 29 — Lazy formulas bootstrap (auto-clone on first use)

Priority: 1

## Deliverable

Ruby parity: Fontist auto-initializes the formulas repository on first use —
`npx fontist install X` must work on a fresh machine without a manual
`fontist update`.

- `FormulasRepo` resolves the remote from `FONTIST_FORMULAS_REPO_URL`
  (default `https://github.com/fontist/formulas.git`) and the branch from
  `FONTIST_FORMULAS_REPO_BRANCH` (default `v5`) — the env override is also a
  genuine feature (mirrors, air-gapped installs) and the test seam.
- `ensureFormulasAvailable(ctx)` in the repo layer: no-op when the repo
  exists; otherwise clones via the existing update flow. Clone failures are
  warned about and swallowed — the subsequent Missing/UnsupportedFontError
  is the meaningful failure (offline behavior unchanged).
- The Font facade and Manifest operations call it once per operation before
  formula lookups. `FormulaRepository` stays model-pure (no repo-layer
  dependency injected into it).

## Acceptance

- Spec: fresh context (no formulas dir) + `FONTIST_FORMULAS_REPO_URL`
  pointing at a local bare remote → `Font.find` auto-clones and reports the
  font as downloadable (MissingFontError), `Font.install` completes, and a
  second call does not re-clone.
- Existing behavior without the env var is untouched (default URL constant).
