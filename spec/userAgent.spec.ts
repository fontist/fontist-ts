// Mirrors fontist/utils/user_agent_spec.rb, fontist/utils/github_url_spec.rb (Ruby gem): representative coverage.
import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { browserHeaders, randomBrowserProfile, ApiGithubUrlResolver, GITHUB_DOWNLOAD_URL } from '../src/download/userAgent.js';

describe('browser header profiles', () => {
  it('returns one of the known profiles with consistent headers', () => {
    for (let i = 0; i < 20; i++) {
      const profile = randomBrowserProfile();
      expect(profile.userAgent).toContain('Chrome/');
      const headers = browserHeaders(profile);
      expect(headers['User-Agent']).toBe(profile.userAgent);
      expect(headers['Sec-Ch-Ua']).toBe(profile.secChUa);
      expect(headers['Upgrade-Insecure-Requests']).toBe('1');
    }
  });

  it('honors a deterministic random source', () => {
    expect(randomBrowserProfile(() => 0).userAgent).toContain('126.0.0.0');
    expect(randomBrowserProfile(() => 0.999).userAgent).toContain('122.0.0.0');
  });
});

describe('GitHub release URL parsing', () => {
  it('parses owner/repo/tag/asset', () => {
    const match = 'https://github.com/fontist/formulas/releases/download/v1.0/my font.zip'.match(GITHUB_DOWNLOAD_URL);
    expect(match).toBeTruthy();
    expect(match!.slice(1)).toEqual(['fontist', 'formulas', 'v1.0', 'my font.zip']);
  });

  it('rejects non-download URLs', () => {
    expect('https://github.com/fontist/formulas/archive/v1.zip'.match(GITHUB_DOWNLOAD_URL)).toBeNull();
    expect('https://example.com/a.zip'.match(GITHUB_DOWNLOAD_URL)).toBeNull();
  });
});

describe('ApiGithubUrlResolver', () => {
  it('passes through without a token', async () => {
    const resolver = new ApiGithubUrlResolver(null);
    expect(
      await resolver.resolve('https://github.com/a/b/releases/download/v1/a.zip'),
    ).toBeNull();
  });

  it('passes through non-GitHub URLs even with a token', async () => {
    const resolver = new ApiGithubUrlResolver('token');
    expect(await resolver.resolve('https://example.com/a.zip')).toBeNull();
  });

  it('resolves the release asset id via the API', async () => {
    let server: Server | null = createServer((req, res) => {
      if (req.url?.includes('/releases/tags/v1')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ assets: [{ id: 424242, name: 'a.zip' }, { id: 1, name: 'b.zip' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server!.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const resolver = new ApiGithubUrlResolver('secret-token', base);
      const resolved = await resolver.resolve('https://github.com/a/b/releases/download/v1/a.zip');
      expect(resolved).toEqual({
        url: `${base}/repos/a/b/releases/assets/424242`,
        headers: { Accept: 'application/octet-stream', Authorization: 'Bearer secret-token' },
      });
      expect(await resolver.resolve('https://github.com/a/b/releases/download/v1/missing.zip')).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });
});
