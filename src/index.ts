/**
 * fontist — install openly-licensed fonts, driven by formulas.
 *
 * Public API surface. Everything not exported here is internal.
 */
export { Font, FontPath, type FontOptions } from './api/font.js';
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
