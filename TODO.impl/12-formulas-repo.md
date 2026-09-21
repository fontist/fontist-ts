Status: DONE — implemented and verified this session.

# 12 — Formulas repo management (git)

Priority: 1

## Deliverable

`src/repo/`:

- `gitClient.ts`: async spawn wrapper over the `git` binary: clone (shallow, branch,
  depth 1), pull, fetch, checkout, currentBranch, config get/set, log (rev/date), status.
  Errors → `BinaryCallError` / `RepoCouldNotBeUpdatedError`; git missing → clear message.
- `formulasRepo.ts`: ensure cloned at `versions/v5/formulas` (shallow clone of
  `https://github.com/fontist/formulas.git` branch v5 when absent); update: pull current
  branch; if on different branch, set refspec, fetch, checkout, pull (Ruby update.rb flow).
  Auto-ensure invoked lazily by FormulaRepository when formulas dir missing.
- `privateRepos.ts`: list/setup(name,url)/update(name)/remove(name)/info(name) under
  `Formulas/private/` — normalized-URL duplicate detection, shallow clone, force-main
  checkout quirk preserved; `Info` { url, revision, createdAt, updatedAt, formulaCount }.
- `update.ts`: `updateFormulas(ctx)` = main repo update + each private repo update, then
  `rebuildFormulaIndexes` always (even on failure paths — mirror Ruby `ensure`).

## Acceptance

- Specs using a local bare git repo as remote (no network): clone, update, private repo
  setup/info/remove, index rebuild triggered.
