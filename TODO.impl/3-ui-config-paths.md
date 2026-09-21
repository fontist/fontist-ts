Status: DONE — implemented and verified this session.

# 3 — UI, Config, paths, context

Priority: 1

## Deliverable

- `src/ui/ui.ts`: `say`, `error`, `warn`, `debug` (log-level gated), `progress` helpers,
  `ask` (readline). Injectable writer for specs. No direct `console` elsewhere.
- `src/config/config.ts`: port Ruby `Config`. Keys: `fonts_path`, `google_fonts_key`,
  `open_timeout`, `read_timeout`, `continue_on_checksum_mismatch`, `use_system_index`,
  `preferred_family`, `update_fontconfig`, `no_progress`, `fonts_install_location`,
  `user_fonts_path`, `system_fonts_path`. Defaults: fonts_path `~/.fontist/fonts`,
  open/read timeout 60. Only set values persist to `~/.fontist/config.yml`.
  Env overrides: `FONTIST_PATH`, `FONTIST_INSTALL_LOCATION`, `FONTIST_USER_FONTS_PATH`,
  `FONTIST_SYSTEM_FONTS_PATH`.
- `src/paths.ts`: `FontistPaths` — fontist path, fonts, downloads, versions/v5, formulas repo
  + Formulas dir, private formulas, index file paths (formula/default-family,
  formula/preferred-family, filename index, fontist/user/system indexes), config.yml.
- `src/context.ts`: `FontistContext` { config, paths, ui } with `defaultContext()` singleton;
  API accepts an injected context (no global mutable state in library code).

## Acceptance

- Precedence ENV > config.yml > default verified by specs.
- `FONTIST_PATH` relocates the whole tree (smoke test uses /tmp home).
