# fontist (TypeScript)

TypeScript port of the [Fontist](https://github.com/fontist/fontist) Ruby gem:
**install openly-licensed fonts** from a single command or a few lines of code,
on macOS, Linux and Windows. Fonts are described by *formulas* — YAML recipes
maintained in the [fontist/formulas](https://github.com/fontist/formulas)
repository — covering download URLs, checksums, licenses, and font metadata.

This package answers fontist/fontist#463 (TypeScript port) and #351 (npm
support).

## Install

```bash
npm install fontist        # library
npx fontist --help         # CLI without installing
```

Requires Node >= 20.

## First run

Fontist keeps its data under `~/.fontist` (override with `FONTIST_PATH`). On
first use it clones the formulas repository (shallow, branch `v5`) and builds
its indexes:

```bash
fontist update             # clone/update formulas repos, rebuild indexes
```

## CLI

```bash
fontist install "Overpass"                  # install a font by name
fontist install "Crimson Text" --accept-all-licenses
fontist install overpass --formula          # install a whole formula by key
fontist install "Overpass" --location user  # fontist | user | system
fontist install "Overpass" --format woff2 --prefer-variable
fontist uninstall "Overpass"
fontist status                              # paths of installed fonts
fontist list                                # formula -> font -> style status
fontist update                              # update formulas + rebuild indexes
fontist manifest locations manifest.yml     # locate fonts in a manifest
fontist manifest install manifest.yml       # install fonts from a manifest
fontist repo setup NAME URL                 # private formulas repositories
fontist config set no_progress true
fontist cache clear
```

Fonts with a required license agreement display the license text and ask for
confirmation; pass `--accept-all-licenses` to accept non-interactively.

## Library API

```ts
import { Font, Manifest, createContext } from 'fontist';

const ctx = await createContext();

// Find a font already on the system (or learn why not)
const paths = await Font.find('Overpass', ctx);

// Install: downloads, verifies sha256, extracts, and installs
const installed = await Font.install('Overpass', ctx, {
  confirmation: 'yes',        // accept license prompts non-interactively
  location: 'fontist',        // fontist | user | system
});

// Declarative manifests
const manifest = await Manifest.fromFile('./fonts.yml');
const located = await manifest.locate(ctx, { locations: true });
await manifest.install(ctx, { confirmation: 'yes' });

// Uninstall
await Font.uninstall('Overpass', ctx);
```

Everything is context-injectable (`createContext({ paths, ui, config,
platform })`), so library embedders can redirect where Fontist reads and
writes; nothing touches global state.

### Install locations

| Location | Path (macOS) | Managed |
|----------|--------------|---------|
| `fontist` (default) | `~/.fontist/fonts/{formula-key}/` | yes |
| `user` | `~/Library/Fonts/fontist/` | yes |
| `system` | `/Library/Fonts/fontist/` (elevated permissions) | yes |

macOS supplementary (MobileAsset) fonts install into their
`com_apple_MobileAsset_Font*` asset directories.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FONTIST_PATH` | Root of the Fontist data directory (default `~/.fontist`) |
| `FONTIST_INSTALL_LOCATION` | Default install location |
| `FONTIST_USER_FONTS_PATH` | Override the user font directory |
| `FONTIST_SYSTEM_FONTS_PATH` | Override the system font directory |
| `FONTIST_PLATFORM_OVERRIDE` | Simulate `macos-font<N>` / `linux` / `windows` |
| `GITHUB_API_TOKEN` | Authenticated GitHub downloads |

## Relationship to the Ruby gem

The behavior, formula schema (v4/v5), file layout (`~/.fontist/versions/v5/...`)
and CLI surface mirror the Ruby gem; both can share a `~/.fontist` directory.
Known gaps (tracked in `TODO.impl/`): WOFF2 metadata indexing and transcoding
desktop→web formats (23/22), Windows Font-on-Demand payloads (21), and native
codecs for 7z/cab/msi archives (23) — these raise clear errors instead of
failing silently.

## Development

```bash
npm install
npm run build       # tsc -> dist/
npm test            # vitest
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

Tests are fully hermetic: synthetic font binaries, in-memory zips, local HTTP
and git servers — no network, no writes to `~/.fontist`.

## License

BSD-2-Clause, same as the Fontist gem.
