/** Randomized browser header profiles — several CDNs reject non-browser
 * user agents, so Fontist presents a browser-like client (as the Ruby gem does). */
export interface BrowserProfile {
  userAgent: string;
  secChUa: string;
  secChUaPlatform: string;
}

const PROFILES: readonly BrowserProfile[] = [
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    secChUaPlatform: '"macOS"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    secChUa: '"Not/A)Brand";v="24", "Chromium";v="125", "Google Chrome";v="125"',
    secChUaPlatform: '"Windows"',
  },
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    secChUa: '"Not)A;Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
    secChUaPlatform: '"Linux"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    secChUaPlatform: '"macOS"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    secChUaPlatform: '"Windows"',
  },
];

export function randomBrowserProfile(random: () => number = Math.random): BrowserProfile {
  return PROFILES[Math.floor(random() * PROFILES.length)]!;
}

export function browserHeaders(profile: BrowserProfile): Record<string, string> {
  return {
    'User-Agent': profile.userAgent,
    'Sec-Ch-Ua': profile.secChUa,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': profile.secChUaPlatform,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

export const GITHUB_DOWNLOAD_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/;

export interface GithubUrlResolver {
  /** Returns the resolved URL + headers, or null to pass the raw URL through. */
  resolve(rawUrl: string): Promise<{ url: string; headers: Record<string, string> } | null>;
}

/** Resolves raw GitHub release-download URLs to authenticated API asset
 * URLs (the assets API requires the numeric asset id and an octet-stream
 * Accept header). Returns null when the URL is not a GitHub release
 * download or no token is available (raw URL passthrough). */
export class ApiGithubUrlResolver {
  constructor(
    private readonly token: string | null,
    private readonly apiBase = 'https://api.github.com',
  ) {}

  async resolve(rawUrl: string): Promise<{ url: string; headers: Record<string, string> } | null> {
    const match = rawUrl.match(GITHUB_DOWNLOAD_URL);
    if (!match || !this.token) return null;
    const [, owner, repo, tag, assetName] = match;
    try {
      const response = await fetch(`${this.apiBase}/repos/${owner}/${repo}/releases/tags/${tag}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return null;
      const release = (await response.json()) as { assets?: { id: number; name: string }[] };
      const asset = release.assets?.find((a) => a.name === assetName);
      if (!asset) return null;
      return {
        url: `${this.apiBase}/repos/${owner}/${repo}/releases/assets/${asset.id}`,
        headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${this.token}` },
      };
    } catch {
      return null;
    }
  }
}
