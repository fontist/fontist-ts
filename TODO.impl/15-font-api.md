Status: DONE — implemented and verified this session.

# 15 — Font facade API

Priority: 1

## Deliverable

`src/api/font.ts` — `Font` class (options: name, confirmation, hideLicenses, noProgress,
force, version, smallest, newest, sizeLimit, formula, updateFontconfig, location,
formatSpec):

- static entry points: `all`, `find`, `install`, `installMany`, `uninstall`, `status`, `list`.
- `find` = system font → downloadable → manual → `UnsupportedFontError`.
- `install` = unless force: system lookup first; download via picker+installer;
  formula-mode installs whole formula; license confirmation flow (show license, ask
  "yes"/enter-cancel, persist acceptance across many installs);
  fontconfig update hook.
- `uninstall` searches Fontist/User/System indexes, resolves location from path
  (fontist path → formula key → FontistLocation), deletes via location.
- `status` (no name: all system font paths), `list` (formula → font → style → installed?
  nested map), `all` (all formula fonts).
- `FontPath` rendering class (path with decorations matching Ruby output).

## Acceptance

- Integration spec: fixture formulas repo + local server: find→missing, install→paths,
  reinstall idempotent, uninstall removes file, status/list shapes.
