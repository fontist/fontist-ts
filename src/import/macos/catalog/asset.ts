export interface CatalogFontInfoData {
  PostScriptFontName?: string;
  FontFamilyName?: string;
  FontStyleName?: string;
  PreferredFamilyName?: string;
  PreferredStyleName?: string;
  PlatformDelivery?: string[];
  DisplayNames?: Record<string, unknown>;
}

export interface CatalogAssetData {
  __BaseURL?: string;
  __RelativePath?: string;
  FontInfo4?: CatalogFontInfoData[];
  Build?: string;
  _CompatibilityVersion?: string;
  FontDesignLanguages?: string[];
  Prerequisite?: string[];
  PlatformDelivery?: string[];
}

export interface MacosImportSourceInit {
  framework_version: number;
  posted_date: string;
  asset_id: string;
}

/** Metadata for a single font within an asset (Ruby
 * Macos::Catalog::FontInfo). */
export class CatalogFontInfo {
  readonly postscriptName: string | null;
  readonly fontFamilyName: string | null;
  readonly fontStyleName: string | null;
  readonly preferredFamilyName: string | null;
  readonly preferredStyleName: string | null;
  readonly platformDelivery: string[];

  constructor(private readonly data: CatalogFontInfoData) {
    this.postscriptName = data['PostScriptFontName'] ?? null;
    this.fontFamilyName = data['FontFamilyName'] ?? null;
    this.fontStyleName = data['FontStyleName'] ?? null;
    this.preferredFamilyName = data['PreferredFamilyName'] ?? null;
    this.preferredStyleName = data['PreferredStyleName'] ?? null;
    this.platformDelivery = data['PlatformDelivery'] ?? [];
  }

  displayNames(): Record<string, unknown> {
    return this.data['DisplayNames'] ?? {};
  }

  /** No platform delivery means compatible with all; macOS (but not
   * macOS-invisible) delivery means compatible. */
  macosCompatible(): boolean {
    if (this.platformDelivery.length === 0) return true;
    return this.platformDelivery.some(
      (platform) => platform.includes('macOS') && platform !== 'macOS-invisible',
    );
  }
}

/** One font asset from a macOS MobileAsset Font catalog (Ruby
 * Macos::Catalog::Asset). */
export class CatalogAsset {
  readonly baseUrl: string | null;
  readonly relativePath: string | null;
  readonly build: string | null;
  readonly compatibilityVersion: string | null;
  readonly designLanguages: string[];
  readonly prerequisite: string[];
  readonly postedDate: string | null;
  readonly frameworkVersion: number | null;

  constructor(
    private readonly data: CatalogAssetData,
    options: { postedDate?: string | null; frameworkVersion?: number | null } = {},
  ) {
    this.baseUrl = data['__BaseURL'] ?? null;
    this.relativePath = data['__RelativePath'] ?? null;
    this.build = data['Build'] ?? null;
    this.compatibilityVersion = data['_CompatibilityVersion'] ?? null;
    this.designLanguages = data['FontDesignLanguages'] ?? [];
    this.prerequisite = data['Prerequisite'] ?? [];
    this.postedDate = options.postedDate ?? null;
    this.frameworkVersion = options.frameworkVersion ?? null;
  }

  get fontInfo(): CatalogFontInfoData[] {
    return this.data['FontInfo4'] ?? [];
  }

  downloadUrl(): string {
    return `${this.baseUrl ?? ''}${this.relativePath ?? ''}`;
  }

  fonts(): CatalogFontInfo[] {
    return this.fontInfo.map((info) => new CatalogFontInfo(info));
  }

  postscriptNames(): string[] {
    return this.fonts().map((f) => f.postscriptName).filter((n): n is string => n !== null);
  }

  fontFamilies(): string[] {
    return [...new Set(this.fonts().map((f) => f.fontFamilyName).filter((n): n is string => n !== null))];
  }

  primaryFamilyName(): string | null {
    return this.fontFamilies()[0] ?? null;
  }

  /** Font7/8 carry a Build field; Font5/6 expose the hash as the zip
   * basename of __RelativePath. */
  assetId(): string | null {
    if (this.build) return this.build.toLowerCase();
    const filename = this.relativePath?.split('/').pop();
    const hash = filename?.split('.')[0];
    return hash ? hash.toLowerCase() : null;
  }

  toImportSource(): MacosImportSourceInit | null {
    if (!this.frameworkVersion || !this.postedDate || !this.assetId()) return null;
    return {
      framework_version: this.frameworkVersion,
      posted_date: this.postedDate,
      asset_id: this.assetId()!,
    };
  }
}
