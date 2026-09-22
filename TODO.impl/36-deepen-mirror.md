Status: DONE — implemented and verified this session.

# 36 — Deepen the Ruby test mirror for install and CLI flows

Priority: 2

## Deliverable

Promote coverage of the largest Ruby specs by porting more of their actual
examples into the mirror suite:

- `font_spec.rb`: "detects, renames and installs the font" (source_font),
  "tells about fetching from cache", "skips download" (installer never runs
  when the font is already installed), "shows font suggestions" /
  interactive pick, `--formula`-mode install, install to user and system
  locations via the API, install honoring FONTIST_PATH.
- `cli_spec.rb`: `manifest locations` / `manifest install` commands,
  `fontconfig update` command (fake fc-cache), `install --formula` mode.
- Registry updates: bump `font_spec.rb` and `cli_spec.rb` notes to reflect
  the widened example coverage.

## Acceptance

- New mirror examples pass; `npm run mirror:check` green; full suite green.
