/** Semantic version comparison ("10.12" < "10.13" < "26.0"). */
export function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** macOS font framework metadata (Ruby MacosFrameworkMetadata). */
export interface MacosFrameworkInfo {
  min_macos_version: string;
  max_macos_version: string | null;
  asset_path: string;
  parser_class: string;
  description: string;
}

export const MACOS_FRAMEWORK_METADATA: ReadonlyMap<number, MacosFrameworkInfo> = new Map([
  [3, {
    min_macos_version: '10.12',
    max_macos_version: '10.12',
    asset_path: '/System/Library/Assets',
    parser_class: 'Fontist::Macos::Catalog::Font3Parser',
    description: 'Font3 framework (macOS Sierra)',
  }],
  [4, {
    min_macos_version: '10.13',
    max_macos_version: '10.13',
    asset_path: '/System/Library/Assets',
    parser_class: 'Fontist::Macos::Catalog::Font4Parser',
    description: 'Font4 framework (macOS High Sierra)',
  }],
  [5, {
    min_macos_version: '10.14',
    max_macos_version: '10.15',
    asset_path: '/System/Library/AssetsV2',
    parser_class: 'Fontist::Macos::Catalog::Font5Parser',
    description: 'Font5 framework (macOS Mojave, Catalina)',
  }],
  [6, {
    min_macos_version: '10.15',
    max_macos_version: '11.99',
    asset_path: '/System/Library/AssetsV2',
    parser_class: 'Fontist::Macos::Catalog::Font6Parser',
    description: 'Font6 framework (macOS Catalina, Big Sur)',
  }],
  [7, {
    min_macos_version: '12.0',
    max_macos_version: '15.99',
    asset_path: '/System/Library/AssetsV2',
    parser_class: 'Fontist::Macos::Catalog::Font7Parser',
    description: 'Font7 framework (macOS Monterey, Ventura, Sonoma, Sequoia)',
  }],
  [8, {
    min_macos_version: '26.0',
    max_macos_version: null,
    asset_path: '/System/Library/AssetsV2',
    parser_class: 'Fontist::Macos::Catalog::Font8Parser',
    description: 'Font8 framework (macOS Tahoe+)',
  }],
]);

export function macosFrameworkMetadata(): ReadonlyMap<number, MacosFrameworkInfo> {
  return MACOS_FRAMEWORK_METADATA;
}

export function macosFrameworkMinVersion(frameworkVersion: number | null): string | null {
  return frameworkVersion === null
    ? null
    : MACOS_FRAMEWORK_METADATA.get(frameworkVersion)?.min_macos_version ?? null;
}

export function macosFrameworkMaxVersion(frameworkVersion: number | null): string | null {
  return frameworkVersion === null
    ? null
    : MACOS_FRAMEWORK_METADATA.get(frameworkVersion)?.max_macos_version ?? null;
}

export function macosFrameworkParserClass(frameworkVersion: number | null): string | null {
  return frameworkVersion === null
    ? null
    : MACOS_FRAMEWORK_METADATA.get(frameworkVersion)?.parser_class ?? null;
}

export function macosFrameworkDescription(frameworkVersion: number | null): string | null {
  return frameworkVersion === null
    ? null
    : MACOS_FRAMEWORK_METADATA.get(frameworkVersion)?.description ?? null;
}

export function macosFrameworkAssetPath(frameworkVersion: number | null): string | null {
  return frameworkVersion === null
    ? null
    : MACOS_FRAMEWORK_METADATA.get(frameworkVersion)?.asset_path ?? null;
}

export function macosFrameworkSystemInstallPath(frameworkVersion: number | null): string | null {
  const base = macosFrameworkAssetPath(frameworkVersion);
  return base === null || frameworkVersion === null
    ? null
    : `${base}/com_apple_MobileAsset_Font${frameworkVersion}`;
}

export function macosFrameworkCompatibleWith(
  frameworkVersion: number | null,
  macosVersion: string,
): boolean {
  const minVersion = macosFrameworkMinVersion(frameworkVersion);
  if (minVersion === null) return false;
  if (compareVersionStrings(macosVersion, minVersion) < 0) return false;
  const maxVersion = macosFrameworkMaxVersion(frameworkVersion);
  if (maxVersion === null) return true;
  return compareVersionStrings(macosVersion, maxVersion) <= 0;
}

/** Newest framework version compatible with the given macOS version. */
export function macosFrameworkForMacos(macosVersion: string): number | null {
  const versions = [...MACOS_FRAMEWORK_METADATA.keys()].sort((a, b) => b - a);
  for (const frameworkVersion of versions) {
    if (macosFrameworkCompatibleWith(frameworkVersion, macosVersion)) {
      return frameworkVersion;
    }
  }
  return null;
}
