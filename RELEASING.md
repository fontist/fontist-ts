# Releasing

1. **Pick the version.** The version number is a maintainer decision — never
   guessed. `package.json` declares the version to publish; bump it
   deliberately (`npm version <x.y.z>` or edit + commit).
2. **Run the gates** (also enforced by `prepublishOnly`):
   `npm run lint && npm run typecheck && npm run build && npm test`
3. **Smoke-test the CLI** from the build:
   `FONTIST_PATH=/tmp/fontist-home node dist/cli/cli.js update && \
    FONTIST_PATH=/tmp/fontist-home node dist/cli/cli.js install akabara-cinderella`
4. **Publish**: `npm publish` (the scoped package publishes as public via
   `publishConfig.access`; add `--tag next` for pre-releases so `latest`
   keeps pointing at the last stable).
5. **Tag and GitHub release**: push the `v<version>` tag created by
   `npm version`, and create the GitHub release with notes from the commits
   since the previous tag.

npm versions are permanent: a version number can never be re-published, even
after `npm unpublish`. Never "try" a version.
