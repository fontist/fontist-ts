import * as path from 'node:path';
import { FontistError } from '../errors/errors.js';
import type { Formula } from '../formula/formula.js';
import { MacosImportSource } from '../formula/importSources.js';

/** Maps macOS framework versions to the MobileAsset directory generation. */
export const FRAMEWORK_TO_MOBILE_ASSET: ReadonlyMap<number, string> = new Map([
  [3, 'com_apple_MobileAsset_Font3'],
  [4, 'com_apple_MobileAsset_Font4'],
  [5, 'com_apple_MobileAsset_Font5'],
  [6, 'com_apple_MobileAsset_Font6'],
  [7, 'com_apple_MobileAsset_Font7'],
  [8, 'com_apple_MobileAsset_Font8'],
]);

/** Synchronous derivation of the MobileAsset path purely from the formula's
 * import_source (framework_version + asset_id). */
export function macosImportSystemPathSync(formula: Formula): string {
  const source = formula.importSource;
  if (!(source instanceof MacosImportSource)) {
    throw new FontistError('Formula is not a macOS import source');
  }
  const frameworkVersion = source.frameworkVersion;
  if (!frameworkVersion) {
    throw new FontistError('Formula does not declare import_source.framework_version');
  }
  const asset = FRAMEWORK_TO_MOBILE_ASSET.get(frameworkVersion);
  if (!asset) {
    throw new FontistError(`Unsupported macOS framework version: ${frameworkVersion}`);
  }
  const assetId = source.assetId;
  if (!assetId) {
    throw new FontistError(
      'Formula does not declare import_source.asset_id; cannot determine MobileAsset directory',
    );
  }
  return path.join(
    '/System/Library/AssetsV2',
    asset,
    `${assetId.slice(0, 6)}${assetId.slice(6)}.asset`,
    'AssetData',
  );
}
