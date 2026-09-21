Status: DONE — implemented and verified this session.

# 18 — Fontconfig integration

Priority: 2

## Deliverable

`src/fontconfig/fontconfig.ts`:

- `update(ctx)`: locate `fc-cache` (`which`-style PATH search); not found →
  `FontconfigNotFoundError`; config file `fonts.conf` missing → `FontconfigFileNotFoundError`
  (checked via `FONTCONFIG_FILE`/`XDG_CONFIG_HOME`); run `fc-cache -f` capturing output;
  failure → `BinaryCallError`. No-op helper `isAvailable()`.

## Acceptance

- Spec with fake `fc-cache` on PATH (tmp bin dir): update invoked with args; missing binary
  raises FontconfigNotFoundError.
