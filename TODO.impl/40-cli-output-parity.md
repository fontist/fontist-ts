Status: DONE — implemented and verified this session.

# 40 — CLI output parity: uninstall/status/update messages and aliases

Priority: 1

## Deliverable

Exact CLI output and aliases from `cli.rb`:

- `uninstall` prints `These fonts are removed:` followed by the removed
  paths; `remove` is an alias for `uninstall` (Ruby `map remove:
  :uninstall`).
- `status` with no fonts installed prints `No font is installed.` and exits
  with STATUS_MISSING_FONT_ERROR (3).
- `update` prints `Formulas have been successfully updated.` on success
  (exit 10 with the error message on failure — already correct).

## Acceptance

- CLI specs: uninstall output text, `remove` alias equivalence, empty-status
  message + exit 3, update success message (with a local git remote).
