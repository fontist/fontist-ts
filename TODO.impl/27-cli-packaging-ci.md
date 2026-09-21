Status: DONE — implemented and verified this session.

# 27 — CLI parity, packaging metadata, CI

Priority: 3

## Deliverable

- `fontist fontconfig update` subcommand (Ruby CLI parity; the
  `--update-fontconfig` install flag stays).
- Fix CLI `status <font>` double-printing paths (Font.status already prints
  via `findSystemFont`; the command must not print again).
- `LICENSE`: BSD-2-Clause text copied verbatim from the Ruby gem
  (Copyright (c) 2020, Ribose).
- `.github/workflows/ci.yml`: lint + typecheck + build + test on Node 20/22.
- GitHub URL rewrite correctness: with `GITHUB_API_TOKEN`, raw
  `github.com/*/releases/download/*` URLs are resolved to API asset URLs
  (tag → asset id) with an octet-stream Accept header, via an injectable
  `GithubUrlResolver` (default hits api.github.com); no token → raw URL
  passthrough. The session-1 query-param rewrite was invalid (asset paths
  are not asset ids) and is replaced.

## Acceptance

- Spec: fontconfig command exists and delegates (fake binary); status prints
  paths exactly once; resolver spec against a local mock API server;
  downloader spec asserts the resolved URL is used with the octet-stream
  header.
