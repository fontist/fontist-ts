import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { FontistError } from '../errors/errors.js';
import type { FontistContext } from '../context.js';
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

/** Runs `sw_vers` and returns the macOS major version (e.g. 14). */
export function macosMajorVersion(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('sw_vers', (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const match = stdout.match(/ProductVersion:\s*(\d+)/);
      resolve(match ? Number.parseInt(match[1]!, 10) : null);
    });
  });
}

/** The asset data directory for a macOS import formula, e.g.
 * `/System/Library/AssetsV2/com_apple_MobileAsset_Font7/<prefix>.asset/AssetData`. */
export async function macosImportSystemPath(ctx: FontistContext, formula: Formula): Promise<string> {
  const source = formula.importSource;
  if (!(source instanceof MacosImportSource)) {
    throw new FontistError('Formula is not a macOS import source');
  }
  const frameworkVersion = source.frameworkVersion ?? (await macosMajorVersion());
  if (!frameworkVersion) {
    throw new FontistError('Could not determine macOS framework version for system installation');
  }
  const asset = FRAMEWORK_TO_MOBILE_ASSET.get(frameworkVersion);
  if (!asset) {
    throw new FontistError(`Unsupported macOS framework version: ${frameworkVersion}`);
  }
  const assetId = source.assetId ?? (await detectAssetId(ctx, asset));
  if (!assetId) {
    throw new FontistError(
      'Could not determine the MobileAsset asset id; set import_source.asset_id in the formula',
    );
  }
  const prefix = assetId.slice(0, 6);
  return path.join(
    '/System/Library/AssetsV2',
    asset,
    `${prefix}${assetId.slice(6)}.asset`,
    'AssetData',
  );
}

/** Synchronous variant used by locations: derives the MobileAsset path purely
 * from the formula's import_source (framework_version + asset_id). */
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

async function detectAssetId(_ctx: FontistContext, _asset: string): Promise<string | null> {
  // Scanning /System/Library/AssetsV2 requires the exact posted-date dir;
  // SIP makes it impractical, so asset_id must come from the formula.
  return null;
}

/** Whether the MobileAsset dir for a framework exists (macOS only). */
export async function mobileAssetDirExists(frameworkVersion: number): Promise<boolean> {
  const asset = FRAMEWORK_TO_MOBILE_ASSET.get(frameworkVersion);
  if (!asset) return false;
  try {
    await fsp.access(path.join('/System/Library/AssetsV2', asset));
    return true;
  } catch {
    return false;
  }
}
