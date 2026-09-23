import { FontFamily } from '../models/fontFamily.js';

/** Base class for Google Fonts API data source clients (Ruby
 * Google::DataSources::Base). The base URL is injectable so tests run
 * against a local server. */
export class BaseDataSource {
  readonly apiKey: string;
  readonly capability: string | null;
  private cache: FontFamily[] | null = null;

  constructor(
    options: { apiKey: string; capability?: string | null; baseUrl?: string; fetchImpl?: typeof fetch },
  ) {
    this.apiKey = options.apiKey;
    this.capability = options.capability ?? null;
    this.baseUrl = options.baseUrl ?? 'https://www.googleapis.com/webfonts/v1/webfonts';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  url(): string {
    const params = new URLSearchParams({ key: this.apiKey });
    if (this.capability) params.set('capability', this.capability);
    return `${this.baseUrl}?${params.toString()}`;
  }

  /** Fetches and parses font families, memoized until clearCache. */
  async fetch(): Promise<FontFamily[]> {
    if (this.cache) return this.cache;
    const raw = await this.fetchRaw();
    this.cache = this.parseResponse(raw);
    return this.cache;
  }

  async fetchRaw(): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url());
    } catch (err) {
      throw new Error(`Failed to fetch from API: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to parse API response: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  parseResponse(raw: Record<string, unknown>): FontFamily[] {
    const items = (raw['items'] ?? []) as Array<Record<string, unknown>>;
    return items.map((item) => FontFamily.fromYamlObject(item) as FontFamily);
  }

  clearCache(): void {
    this.cache = null;
  }
}

/** TTF endpoint (default capability; Ruby DataSources::Ttf). */
export class TtfDataSource extends BaseDataSource {
  constructor(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    super(options);
  }
}

/** VF endpoint (capability=VF; includes axes; Ruby DataSources::Vf). */
export class VfDataSource extends BaseDataSource {
  static readonly CAPABILITY = 'VF';

  constructor(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    super({ ...options, capability: VfDataSource.CAPABILITY });
  }
}

/** WOFF2 endpoint (capability=WOFF2; Ruby DataSources::Woff2). */
export class Woff2DataSource extends BaseDataSource {
  static readonly CAPABILITY = 'WOFF2';

  constructor(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    super({ ...options, capability: Woff2DataSource.CAPABILITY });
  }
}
