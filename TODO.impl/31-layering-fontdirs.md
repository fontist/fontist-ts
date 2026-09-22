Status: DONE — implemented and verified this session.

# 31 — Layering: platform font directories belong to the system layer

Priority: 3

## Deliverable

`system/systemFont.ts` imports `defaultUserFontPath` from the locations
layer (system → locations dependency, the only inverted edge in the code
base). Move platform font-directory resolution into
`src/system/fontDirs.ts` (pure os/path module); locations and the Font API
import it from there. Behavior identical, dependency direction restored:
locations → system, never the reverse.

## Acceptance

- `grep` shows no `system/*` module importing from `locations/*`.
- Typecheck, lint, and full suite unchanged and green.
