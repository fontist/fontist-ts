# 43. Import source models — align with current Ruby semantics

Status: DONE — implemented and verified this session.

`src/formula/importSources.ts` existed from round 1 but drifted from the CURRENT
Ruby sources (`import_source.rb`, `*_import_source.rb`). This round aligns it:

- `ImportSource#differentiationKey`/`isOutdated` raise (NotImplementedError in
  Ruby) instead of returning null/false.
- Macos: `differentiationKey = assetId&.downcase`; `outdated?` compares
  `posted_date` only (NOT framework version); adds `minMacosVersion`,
  `maxMacosVersion`, `compatibleWithMacos`, `parserClassName`, `description`
  via `MacosFrameworkMetadata`.
- Google: `differentiationKey = nil` (live service, no versioned filenames);
  `outdated?` = commit ids differ (when both present).
- Sil: `differentiationKey = version`; `outdated?` = lexicographic `<`.
- Windows: `differentiationKey = capabilityName`; `outdated?` always false.
- `equals()` per subclass mirroring Ruby `==`.

Also adds `src/import/macos/frameworkMetadata.ts` (MacosFrameworkMetadata port:
METADATA map for frameworks 3–8, min/max versions, parser classes, asset paths,
compat checks, `frameworkForMacos`).

Mirror spec: `spec/mirror/import_source_spec.ts` (5 Ruby specs).
