Status: DONE — implemented and verified this session.

# 19 — Specs (full suite)

Priority: 1 (quality gate)

## Deliverable

`spec/` vitest suite, mirroring every module. No network in tests: local node http servers
for downloads; local bare git remotes for repo specs; fixture fonts/formulas generated into
tmp dirs via test helpers (`spec/helpers/`). Every spec injects a `FontistContext` rooted in
a tmp dir (FONTIST_PATH-style isolation) — no writes to real `~/.fontist`.

Files:
- serialization round-trips; errors; config/paths; ui
- sfnt parsing (fixtures: ttf, otf, ttc), magic table
- formula models v4/v5, repository, picker, format matcher, style/version compare, suggestion
- downloader (retry/sha/cache), cache map format
- extract (zip, nested zip, tar.gz, traversal rejection, unknown format)
- system scanning + indexes; installed indexes add/remove/rebuild short-circuit
- formula indexes rebuild/lookup; repo management against local remote
- locations; installer pipeline; font API integration; manifest; CLI commands + exit codes;
  fontconfig

## Acceptance

- `npm test` green; coverage of every public class' happy + error paths.
