// Mirrors fontist/cli_spec.rb, fontist/cache_cli_spec.rb, fontist/config_cli_spec.rb, fontist/repo_cli_spec.rb (Ruby gem): representative coverage.
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/cli.js';
import { DownloadCache } from '../src/download/downloadCache.js';
import { cleanup, fontFileFor, makeZip, testEnv, writeFormula, type TestEnv } from './helpers/index.js';

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];
let env: TestEnv;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/cli.zip')) {
      const font = fontFileFor({ family: 'Cli Sans', subfamily: 'Regular', fullName: 'Cli Sans Regular' });
      const zip = makeZip([{ name: 'CliSans-Regular.ttf', data: font.data }]);
      res.writeHead(200, { 'Content-Length': zip.length });
      res.end(zip);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  // env is recreated per test; keep only the latest for cleanup simplicity
});

async function freshEnv(): Promise<TestEnv> {
  if (env) await cleanup(env);
  env = await testEnv();
  envs.push(env);
  await writeFormula(env, 'cli_sans', {
    name: 'Cli Sans Formula',
    fonts: [
      {
        name: 'Cli Sans',
        styles: [
          {
            family_name: 'Cli Sans',
            type: 'Regular',
            full_name: 'Cli Sans Regular',
            post_script_name: 'CliSans-Regular',
            font: 'CliSans-Regular.ttf',
          },
        ],
      },
    ],
    resources: { 'cli.zip': { urls: [`${baseUrl}/cli.zip`] } },
  });
  return env;
}

function argv(command: string): string[] {
  // Quote-aware split so multi-word font names stay one argument,
  // mirroring shell usage: fontist install "Cli Sans".
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"|"$/g, '')).filter((part) => part.length > 0);
}

async function run(command: string | string[]): Promise<number> {
  const args = Array.isArray(command) ? command : argv(command);
  return runCli(args, { FONTIST_PATH: env.ctx.paths.fontistPath() } as NodeJS.ProcessEnv, env.ui);
}

describe('CLI', () => {
  it('reports the version and exits 0', async () => {
    await freshEnv();
    const code = await run(argv('version'));
    expect(code).toBe(0);
    expect(env.ui.lines.join('\n')).toContain('fontist');
  });

  it('installs a font and shows the install path', async () => {
    await freshEnv();
    const code = await run(argv('install "Cli Sans" -a -p'));
    expect(code).toBe(0);
    const output = env.ui.lines.join('\n');
    expect(output).toContain('Fonts installed at:');
    expect(output).toContain('CliSans-Regular.ttf');
    await expect(fsp.access(env.ctx.paths.fontsPath())).resolves.toBeUndefined();
  });

  it('exits with the licensing code without --accept-all-licenses', async () => {
    await freshEnv();
    await writeFormula(env, 'exclusive_font', {
      name: 'Cli Exclusive Formula',
      requires_license_agreement: 'CONTACT VENDOR',
      fonts: [
        {
          name: 'Cli Exclusive',
          styles: [{ family_name: 'Cli Exclusive', type: 'Regular', full_name: 'Cli Exclusive Regular', font: 'CliExclusive-Regular.ttf' }],
        },
      ],
      resources: { 'exclusive.zip': { urls: [`${baseUrl}/cli.zip`] } },
    });
    const code = await run(argv('install "Cli Exclusive" -p'));
    expect(code).toBe(4);
    expect(env.ui.lines.join('\n')).toContain('CONTACT VENDOR');
  });

  it('exits 2 for unsupported fonts, 3 for missing ones', async () => {
    await freshEnv();
    expect(await run(argv('install Totally Unknown Font'))).toBe(2);
    expect(await run(argv('status "Cli Sans"'))).toBe(3);
  });

  it('uninstalls installed fonts', async () => {
    await freshEnv();
    await run(argv('install "Cli Sans" -a -p'));
    const code = await run(argv('uninstall "Cli Sans"'));
    expect(code).toBe(0);
    const listOutput: string[] = [];
    env.ui.lines.length = 0;
    await run(argv('list "Cli Sans"'));
    listOutput.push(...env.ui.lines);
    expect(listOutput.join('\n')).toContain('not installed');
  });

  it('list shows installed state after install', async () => {
    await freshEnv();
    await run(argv('install "Cli Sans" -a -p'));
    env.ui.lines.length = 0;
    await run(argv('list "Cli Sans"'));
    expect(env.ui.lines.join('\n')).toContain('installed');
  });

  it('config set/get/delete round-trips through config.yml', async () => {
    await freshEnv();
    expect(await run(argv('config set open_timeout 30'))).toBe(0);
    env.ui.lines.length = 0;
    await run(argv('config get open_timeout'));
    expect(env.ui.lines.join('\n')).toContain('30');
    const saved = await fsp.readFile(env.ctx.paths.configYmlPath(), 'utf8');
    expect(saved).toContain('open_timeout');
    expect(await run(argv('config delete open_timeout'))).toBe(0);
    env.ui.lines.length = 0;
    await run(argv('config get open_timeout'));
    expect(env.ui.lines.join('\n')).toContain('60');
    expect(await run(argv('config get nonsense_key'))).toBe(16);
  });

  it('cache path/clear commands work', async () => {
    await freshEnv();
    env.ui.lines.length = 0;
    await run(argv('cache path'));
    expect(env.ui.lines.join('\n')).toContain('downloads');
    const cache = new DownloadCache(env.ctx);
    const source = path.join(env.home, 'cached.bin');
    await fsp.writeFile(source, 'cached content');
    await cache.put('x', source);
    expect(await run(argv('cache clear'))).toBe(0);
    expect(await cache.get('x')).toBeNull();
  });

  it('index rebuild rebuilds formula indexes', async () => {
    await freshEnv();
    const code = await run(argv('index rebuild'));
    expect(code).toBe(0);
    await expect(fsp.access(env.ctx.paths.formulaDefaultFamilyIndexPath())).resolves.toBeUndefined();
  });

  it('repo list/info work against the private formulas dir', async () => {
    await freshEnv();
    env.ui.lines.length = 0;
    await run(argv('repo list'));
    expect(env.ui.lines.join('\n')).toBe('');
    const code = await run(argv('repo info ghost'));
    expect(code).toBe(8);
  });
});
