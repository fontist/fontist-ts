/**
 * fontist — install openly-licensed fonts, driven by formulas.
 *
 * Public API surface. Everything not exported here is internal.
 */
export { Font, type FontOptions } from './api/font.js';
export { FontPath } from './fonts/fontPath.js';
export { Manifest, ManifestFont, type ManifestResponseFont, type ManifestResponseStyle } from './api/manifest.js';

export { Formula, FormulaCollection, keyFromPath, titleize } from './formula/formula.js';
export { FormulaRepository, nameToKey } from './formula/formulaRepository.js';
export { FormatSpec, parseVariableAxes, type FormatSpecOptions } from './formula/formatSpec.js';
export {
  FormatMatcher,
  canConvert,
  DESKTOP_FORMATS,
  WEB_FORMATS,
  ALL_FORMATS,
  type InstallationStrategy,
} from './formula/formatMatcher.js';
export { FormulaPicker, FORMULA_SIZE_LIMIT_MB } from './formula/formulaPicker.js';
export { FormulaSuggestion } from './formula/formulaSuggestion.js';
export { FontFinder, FontMatch, detectCategoryFromName } from './formula/fontFinder.js';
export { StyleVersion } from './formula/styleVersion.js';
export {
  Extract,
  ExtractOptions,
  FontCollection,
  FontModel,
  FontStyle,
  Resource,
} from './formula/models.js';
export {
  IMPORT_SOURCE_REGISTRY,
  GoogleImportSource,
  ImportSource,
  MacosImportSource,
  SilImportSource,
  WindowsImportSource,
} from './formula/importSources.js';

export { Config, type ConfigKey, type ConfigValues } from './config/config.js';
export { FontistPaths, FORMULAS_REPO_URL, FORMULAS_VERSION } from './paths.js';
export { createContext, resolvePlatform, FONTIST_VERSION, type FontistContext } from './context.js';
export { UI, type UiWriter } from './ui/ui.js';
export type { FontistPlatform } from './ui/ui.js';

export {
  Archive,
  defaultRegistry as defaultExtractorRegistry,
} from './extract/archive.js';
export { ExtractorRegistry, type Extractor } from './extract/extractor.js';

export { Downloader, type DownloadOptions, type DownloadResult } from './download/downloader.js';
export { DownloadCache } from './download/downloadCache.js';

export { FontFile, type FontFileInfo } from './fonts/fontFile.js';
export { detectFormat, type FontBinaryFormat } from './fonts/sfnt/magic.js';
export { SfntFont } from './fonts/sfnt/sfntFont.js';
export { SfntCollection } from './fonts/sfnt/collection.js';
export { assembleSfnt } from './fonts/sfnt/assemble.js';
export { encodeWoff1, loadWoff1, type WoffTable } from './fonts/woff/woff1.js';
export { decodeWoff2, encodeWoff2, loadWoff2 } from './fonts/woff/woff2.js';

export {
  CreateFormula,
  type CreateFormulaOptions,
} from './import/createFormula.js';
export {
  FormulaBuilder,
  ManualFormulaBuilder,
  normalizeFilename,
  nameToFilename,
} from './import/formulaBuilder.js';
export { RecursiveExtraction, SUPPORTED_FONT_EXTENSIONS } from './import/recursiveExtraction.js';
export { FontMetadataExtractor, extractFontMetadata } from './import/fontMetadataExtractor.js';
export { FontMetadata } from './import/models/fontMetadata.js';
export { ImportFontFile } from './import/otf/fontFile.js';
export { FontDetector } from './import/files/fontDetector.js';
export { CollectionFile } from './import/files/collectionFile.js';
export { FontParsingErrorCollector } from './import/fontParsingErrorCollector.js';
export { TextHelper } from './import/helpers/textHelper.js';
export { V4ToV5Migrator, type MigrateAllSummary } from './import/v4ToV5Migrator.js';
export { SilImporter, extractVersionFromUrl, type SilImportResults } from './import/silImporter.js';
export { GoogleApi } from './import/google/api.js';
export {
  FontDatabase,
  TtfDataSource,
  VfDataSource,
  Woff2DataSource,
  GithubDataSource,
} from './import/google/fontDatabase.js';
export {
  GoogleFontsImporter,
  type GoogleFontsImportOptions,
  type GoogleFontsImportResults,
} from './import/google/googleFontsImporter.js';
export {
  Axis,
  FontFamily,
  FontVariant,
  Metadata,
  ValidationError as MetadataValidationError,
} from './import/google/models/models.js';
export {
  CatalogManager,
  Font3CatalogParser,
  Font4CatalogParser,
  Font5CatalogParser,
  Font6CatalogParser,
  Font7CatalogParser,
  Font8CatalogParser,
} from './import/macos/catalog/catalogManager.js';
export { CatalogAsset, CatalogFontInfo } from './import/macos/catalog/asset.js';
export { MacosImporter, type MacosImportOptions } from './import/macos/macosImporter.js';
export {
  MACOS_FRAMEWORK_METADATA,
  macosFrameworkCompatibleWith,
  macosFrameworkForMacos,
  macosFrameworkMetadata,
} from './import/macos/frameworkMetadata.js';
export { WindowsFodMetadata } from './import/windows/windowsFodMetadata.js';
export {
  parsePlatformOverride,
  userOs as systemUserOs,
  macosVersion as systemMacosVersion,
  parseMacosVersion,
  versionInRange,
  catalogVersionForMacos,
  runPowershell,
  type PlatformOverride,
  type PowerShellResult,
  type RunPowershell,
} from './system/systemUtils.js';
export { WindowsImport } from './import/windows/windowsImport.js';

export {
  createInstallLocation,
  BaseLocation,
  FontistLocation,
  UserLocation,
  SystemLocation,
  MacosImportLocation,
  type InstallLocationType,
} from './locations/installLocation.js';

export { FontInstaller } from './installer/fontInstaller.js';
export { ResourceInstallerRegistry } from './installer/resourceInstallers.js';
export { TranscoderRegistry } from './installer/transcode.js';

export { SystemFont, type FoundStyle } from './system/systemFont.js';
export { scanFontPaths } from './system/pathScanning.js';

export { FormulaIndexRegistry } from './index/formula/formulaFontIndex.js';
export {
  DefaultFamilyFontIndex,
  FormulaFilenameIndex,
  PreferredFamilyFontIndex,
} from './index/formula/formulaFontIndex.js';
export {
  SystemIndexFont,
  SystemIndexFontCollection,
} from './index/installed/systemIndexFont.js';
export { FontistIndex, SystemIndex, UserIndex } from './index/installed/collectionIndexes.js';

export { GitClient } from './repo/gitClient.js';
export { FormulasRepo } from './repo/formulasRepo.js';
export { PrivateRepos, type RepoInfo } from './repo/privateRepos.js';
export { updateFormulas } from './repo/update.js';

export { Fontconfig } from './fontconfig/fontconfig.js';

export * from './errors/errors.js';

export { compareVersions } from './util/compare.js';
export { withLock } from './util/locking.js';

export { runCli } from './cli/cli.js';
export * from './cli/exitCodes.js';
