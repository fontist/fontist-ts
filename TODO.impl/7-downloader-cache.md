Status: DONE — implemented and verified this session.

# 7 — Downloader and download cache

Priority: 1

## Deliverable

`src/download/`:

- `userAgent.ts`: the 5 randomized Chrome browser-header profiles (anti-403), as in Ruby
  `utils/user_agent.rb`.
- `downloader.ts`: `download(url, { sha256?, fileSize?, progress, context })`:
  - cache lookup first (when `useCache`), then network via global `fetch`
  - retries: 3 attempts, exponential backoff min(2^n, 30)s; timeout from config
    open/read timeout (AbortSignal.timeout per attempt)
  - headers: random browser profile; GitHub URLs rewritten to authenticated API URLs when
    `GITHUB_API_TOKEN` present
  - sha256 verification against the allowed list → `TamperedFileError`; on tamper delete
    cached copy and retry once, then `InvalidResourceError`
  - progress: single-line `Downloading: NN% (M/N MiB)` on TTY, silent otherwise
- `downloadCache.ts`: `~/.fontist/downloads/map.yml` URL → relative stored path
  (`tmpXXXX/filename`, filename from response Content-Disposition / URL path, truncated
  255 chars, extension backfilled from content-type); lockfile (`.lock`, retry loop) around
  map read-modify-write; atomic writes (tmp + rename).

## Acceptance

- Specs with a local HTTP server (node http): success, retry on 500 then success, sha mismatch,
  cache hit (no second request), map.yml contents, filename truncation.
