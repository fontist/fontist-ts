import type { FontistContext } from '../../context.js';
import { TtfDataSource, VfDataSource, Woff2DataSource } from './fontDatabase.js';
import { FontDatabase } from './fontDatabase.js';
import type { FontFamily } from './models/fontFamily.js';

export interface ApiOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  ctx: FontistContext;
}

/** Facade over the unified Google Fonts database (Ruby Google::Api). */
export class GoogleApi {
  private readonly options: ApiOptions;
  private database: FontDatabase | null = null;
  private ttfClient: TtfDataSource | null = null;
  private vfClient: VfDataSource | null = null;
  private woff2Client: Woff2DataSource | null = null;

  constructor(options: ApiOptions) {
    this.options = options;
  }

  async items(): Promise<FontFamily[]> {
    return (await this.db()).allFonts();
  }

  async fontByName(name: string): Promise<FontFamily | null> {
    return (await this.db()).fontByName(name);
  }

  async byCategory(category: string): Promise<FontFamily[]> {
    return (await this.db()).byCategory(category);
  }

  async variableFontsOnly(): Promise<FontFamily[]> {
    return (await this.db()).variableFontsOnly();
  }

  async staticFontsOnly(): Promise<FontFamily[]> {
    return (await this.db()).staticFontsOnly();
  }

  async fontsCount(): Promise<{ total: number; variable: number; static: number }> {
    return (await this.db()).fontsCount();
  }

  async ttfData(): Promise<FontFamily[]> {
    return this.ttf().fetch();
  }

  async vfData(): Promise<FontFamily[]> {
    return this.vf().fetch();
  }

  async woff2Data(): Promise<FontFamily[]> {
    return this.woff2().fetch();
  }

  clearCache(): void {
    this.ttfClient?.clearCache();
    this.vfClient?.clearCache();
    this.woff2Client?.clearCache();
    this.database = null;
  }

  private async db(): Promise<FontDatabase> {
    if (!this.database) {
      const [ttfData, vfData, woff2Data] = await Promise.all([
        this.ttf().fetch(),
        this.vf().fetch(),
        this.woff2().fetch(),
      ]);
      this.database = new FontDatabase({
        ttfData,
        vfData,
        woff2Data,
        version: 5,
        ctx: this.options.ctx,
      });
    }
    return this.database;
  }

  private key(): string {
    const key = this.options.apiKey ?? this.options.ctx.env['GOOGLE_FONTS_API_KEY'] ?? null;
    if (!key) throw new Error('GOOGLE_FONTS_API_KEY environment variable not set');
    return key;
  }

  private ttf(): TtfDataSource {
    if (!this.ttfClient) {
      this.ttfClient = new TtfDataSource({
        apiKey: this.key(),
        baseUrl: this.options.baseUrl,
        fetchImpl: this.options.fetchImpl,
      });
    }
    return this.ttfClient;
  }

  private vf(): VfDataSource {
    if (!this.vfClient) {
      this.vfClient = new VfDataSource({
        apiKey: this.key(),
        baseUrl: this.options.baseUrl,
        fetchImpl: this.options.fetchImpl,
      });
    }
    return this.vfClient;
  }

  private woff2(): Woff2DataSource {
    if (!this.woff2Client) {
      this.woff2Client = new Woff2DataSource({
        apiKey: this.key(),
        baseUrl: this.options.baseUrl,
        fetchImpl: this.options.fetchImpl,
      });
    }
    return this.woff2Client;
  }
}
