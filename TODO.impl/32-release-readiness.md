Status: DONE — implemented and verified this session.

# 32 — Release readiness

Priority: 1 (gates the requested release)

## Deliverable

Everything needed for the npm release except the version decision itself:

- `prepublishOnly` guard: lint + typecheck + build + test before any publish.
- `npm pack --dry-run` audit: the tarball contains exactly `dist/` plus the
  auto-included README/LICENSE; no specs, fixtures, TODO.impl, or scripts.
- Built `dist/cli/cli.js` retains its `#!/usr/bin/env node` shebang.
- `RELEASING.md`: the release procedure (version bump, gates, `npm publish`,
  git tag + GitHub release notes) — the checklist executed at release time.
- The actual publish/tag is **explicitly gated**: the exact version number
  comes from the maintainer (package.json currently declares
  `1.0.0-alpha.1` from the bootstrap, which was a placeholder — never
  published). No version is picked or pushed without that decision.

## Acceptance

- `npm pack --dry-run` listing verified; shebang present; prepublishOnly
  wired; RELEASING.md reviewed against the real commands.
