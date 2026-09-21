Status: DONE — implemented and verified this session.

# 6 — Formula models and repository

Priority: 1

## Deliverable

`src/formula/`:

- `models.ts`: `Resource` (name, source, urls, sha256, fileSize, family, files, format
  ttf/otf/woff2/ttc/otc, variableAxes, capabilityName; helpers `isVariableFont`,
  `isCollectionFile`), `FontModel` (name, styles), `FontCollection` (filename,
  sourceFilename, fonts), `FontStyle` (familyName, type, fullName, postScriptName, version,
  description, copyright, font, sourceFont, preferredFamilyName, preferredType,
  defaultFamilyName, defaultType, override; v5: formats, variableFont, variableAxes,
  sourceResource), `Extract` + `ExtractOptions`.
- `importSources.ts`: `ImportSource` base + `MacosImportSource` (frameworkVersion, postedDate,
  assetId), `GoogleImportSource` (commitId, apiVersion, lastModified, familyId),
  `SilImportSource` (version, releaseDate), `WindowsImportSource` (capabilityName,
  minWindowsVersion), registry by `type` tag, `isOutdated(other)` comparisons.
- `formula.ts`: `Formula` model with every Ruby attribute; `keyValue` mapping including
  `resources` childMappings (key folded into `name`), `schema_version` rendered only when 5.
  Methods: `key` (derived from path), `license` (openLicense || requiresLicenseAgreement),
  `licenseRequired`, `isDownloadable`, `isManual`, `allFonts` (fonts + collection fonts with
  style.font/sourceFont rewritten to the collection filename — documented intentional
  normalization), `fontByName`/`fontsByName` (case-insensitive), `styleOverride`,
  `compatibleWithPlatform(os)`, `requiresSystemInstallation`, `minFontist` gating,
  `isV5`. `FormulaCollection`.
- `formulaRepository.ts`: `all()` (glob `formulas/**/*.yml`, skip unparseable with UI warn),
  `allKeys`, `find(fontName)` (via formula font index), `findMany`, `findByKey`,
  `findByKeyOrName`, `findByName` (name→key: lowercase, spaces→underscore), `fromFile`,
  `titleize` for default names. Injectable root dir for specs.
- `styleVersion.ts` + `util/versionCompare.ts`: `StyleVersion` (split `;`, split `.`,
  array compare) and Gem::Version-like compare for `min_fontist`.

## Acceptance

- Spec loads real-world-shaped v4 and v5 formula fixtures; key derivation, downloadable?,
  fontByName, collection font normalization, platform matching all covered.
