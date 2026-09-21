Status: DONE — implemented and verified this session.

# 17 — CLI

Priority: 2

## Deliverable

`src/cli/` (commander):

- Commands: `version`, `install FONT...` (flags: --force/-f, --formula/-F,
  --accept-all-licenses/-a, --hide-licenses/-h, --no-progress/-p, --version/-V,
  --smallest/-s, --newest/-n, --size-limit/-S, --update-fontconfig/-u, --location/-l
  fontist|user|system, --format, --variable-axes, --prefer-variable, --collection-index),
  `uninstall FONT...`, `status [FONT]`, `list [FONT]`, `update`, `manifest install|locations FILE`,
  `config set|get|delete|list`, `cache clear|path`, `index rebuild|build|dump`,
  `repo setup|update|remove|list|info NAME [URL]`.
- `exitCodes.ts`: error class → exit code mapping (2 unsupported, 3 missing, 4 licensing,
  5/6 manifest, 7 index corrupted, 8 repo not found, 9 main repo not found, 10 repo update,
  11 manual, 12 size limit, 13 formula not found, 14/15 fontconfig, 15 fontist version,
  16 invalid config attribute; 1 unknown).
- `cliContext.ts`: builds FontistContext from flags/env; `--verbose` → debug logging.

## Acceptance

- Spec: commander program invoked programmatically; install/status/list/uninstall against
  fixture context; exit codes for each mapped error class.
