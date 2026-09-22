// Mirrors spec/fontist/macos_framework_metadata_spec.rb (Ruby gem).
import { describe, expect, it } from 'vitest';
import {
  FRAMEWORK_TO_MOBILE_ASSET,
  macosImportSystemPathSync,
} from '../../src/locations/macosFramework.js';
import { Formula } from '../../src/formula/formula.js';
import { FontistError } from '../../src/errors/errors.js';

describe('MacosFrameworkMetadata', () => {
  it('maps framework versions 3 through 8', () => {
    for (const version of [3, 4, 5, 6, 7, 8]) {
      expect(FRAMEWORK_TO_MOBILE_ASSET.get(version)).toBe(`com_apple_MobileAsset_Font${version}`);
    }
    expect(FRAMEWORK_TO_MOBILE_ASSET.has(2)).toBe(false);
  });

  it('derives the AssetData path from the formula import source', () => {
    const formula = Formula.fromYaml(`---
import_source:
  type: macos
  framework_version: 8
  asset_id: 10m11177
`) as Formula;
    const resolved = macosImportSystemPathSync(formula);
    expect(resolved).toContain('/System/Library/AssetsV2/com_apple_MobileAsset_Font8/');
    expect(resolved).toContain('10m11177.asset/AssetData');
  });

  it('raises when framework version or asset id are missing', () => {
    const noVersion = Formula.fromYaml('import_source:\n  type: macos\n') as Formula;
    expect(() => macosImportSystemPathSync(noVersion)).toThrow(FontistError);
    const noAsset = Formula.fromYaml(
      'import_source:\n  type: macos\n  framework_version: 7\n',
    ) as Formula;
    expect(() => macosImportSystemPathSync(noAsset)).toThrow(/asset_id/);
  });
});
