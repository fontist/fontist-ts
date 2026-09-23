// Mirrors fontist/cli_spec.rb, fontist/cache_cli_spec.rb, fontist/config_cli_spec.rb, fontist/repo_cli_spec.rb (Ruby gem): representative coverage.
import { createServer, type Server } from 'node:http';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/cli.js';
import { DownloadCache } from '../src/download/downloadCache.js';
import { cleanup, fontFileFor, makeTtc, makeTtf, makeZip, testEnv, writeFormula, type TestEnv } from './helpers/index.js';
import * as yaml from 'yaml';
import * as os from 'node:os';

const cwd = process.cwd();

let server: Server;
let baseUrl: string;
const envs: TestEnv[] = [];
let env: TestEnv;

let collectionPayload: Buffer | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/collection.zip') && collectionPayload) {
      res.writeHead(200, { 'Content-Length': collectionPayload.length });
      res.end(collectionPayload);
      return;
    }
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

  it('uninstalls a collection font by face family name', async () => {
    await freshEnv();
    await writeFormula(env, 'collection_pack', {
      name: 'Collection Pack',
      font_collections: [
        {
          filename: 'Pack.ttc',
          fonts: [
            { name: 'Pack Face One', styles: [{ family_name: 'Pack Face One', type: 'Regular', full_name: 'Pack Face One', font: 'Pack.ttc' }] },
          ],
        },
      ],
      resources: { 'c.zip': { urls: [`${baseUrl}/collection.zip`] } },
    });
    collectionPayload = makeZip([
      { name: 'Pack.ttc', data: makeTtc([{ family: 'Pack Face One', subfamily: 'Regular', fullName: 'Pack Face One' }]) },
    ]);
    expect(await run(argv('install "Pack Face One" -a -p'))).toBe(0);
    env.ui.lines.length = 0;
    expect(await run(argv('status "Pack Face One"'))).toBe(0);
    expect(env.ui.lines.join('\n')).toContain('Pack.ttc');
    expect(await run(argv('uninstall "Pack Face One"'))).toBe(0);
    expect(await run(argv('status "Pack Face One"'))).toBe(3);
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

  it('rebuild-index rebuilds formula indexes', async () => {
    await freshEnv();
    const code = await run(argv('rebuild-index'));
    expect(code).toBe(0);
    await expect(fsp.access(env.ctx.paths.formulaDefaultFamilyIndexPath())).resolves.toBeUndefined();
  });

  it('index rebuild builds the system font index; path/list/clear manage it', async () => {
    await freshEnv();
    expect(await run(argv('index rebuild'))).toBe(0);
    await expect(fsp.access(env.ctx.paths.systemIndexPath())).resolves.toBeUndefined();

    env.ui.lines.length = 0;
    expect(await run(argv('index path'))).toBe(0);
    expect(env.ui.lines.join('\n')).toContain(env.ctx.paths.systemIndexPath());

    env.ui.lines.length = 0;
    expect(await run(argv('index list --format json --limit 5'))).toBe(0);
    const listed = JSON.parse(env.ui.lines.join('\n'));
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.length).toBeLessThanOrEqual(5);
    for (const entry of listed) {
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('family_name');
    }

    env.ui.lines.length = 0;
    expect(await run(argv('index clear'))).toBe(0);
    expect(env.ui.lines.join('\n')).toContain('System font index cleared');
    await expect(fsp.access(env.ctx.paths.systemIndexPath())).rejects.toThrow();
  });

  it('index update reports missing index and no-change updates', async () => {
    await freshEnv();
    env.ui.lines.length = 0;
    expect(await run(argv('index update'))).toBe(1);
    expect(env.ui.lines.join('\n')).toContain("Run 'fontist index rebuild' to create it");

    expect(await run(argv('index rebuild'))).toBe(0);
    env.ui.lines.length = 0;
    expect(await run(argv('index update'))).toBe(0);
    const output = env.ui.lines.join('\n');
    expect(output.match(/System font index updated|No changes detected/)).not.toBeNull();
  });

  it('migrate-formulas upgrades a v4 formula file', async () => {
    await freshEnv();
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cli-migrate-'));
    try {
      const formulaPath = path.join(dir, 'legacy.yml');
      await fsp.writeFile(
        formulaPath,
        'name: Legacy\nresources:\n  res:\n    urls: ["https://example.com/MyFont-Regular.ttf"]\n',
      );
      const code = await run(argv(`migrate-formulas ${formulaPath}`));
      expect(code).toBe(0);
      const migrated = yaml.parse(await fsp.readFile(formulaPath, 'utf8'));
      expect(migrated['schema_version']).toBe(5);
      expect(migrated['resources']['res']['format']).toBe('ttf');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('create-formula generates a formula from a local archive', async () => {
    await freshEnv();
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cli-create-'));
    try {
      const zipPath = path.join(dir, 'TestFont.zip');
      await fsp.writeFile(
        zipPath,
        makeZip([
          {
            name: 'TestFont-Regular.ttf',
            data: makeTtf({ family: 'TestFont', subfamily: 'Regular', fullName: 'TestFont' }),
          },
        ]),
      );
      process.chdir(dir);
      try {
        const code = await run(argv(`create-formula ${zipPath}`));
        expect(code).toBe(0);
        const formulaFile = path.join(dir, 'testfont.yml');
        const formula = yaml.parse(await fsp.readFile(formulaFile, 'utf8'));
        expect(formula['schema_version']).toBe(5);
        expect(formula['fonts'][0]['name']).toBe('TestFont');
        expect(env.ui.lines.join('\n')).toContain('formula has been successfully created');
      } finally {
        process.chdir(cwd);
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('macos-catalogs exits 1 with hints when no catalogs exist', async () => {
    await freshEnv();
    env.ui.lines.length = 0;
    const code = await run(argv('macos-catalogs'));
    expect(code).toBe(1);
    const output = env.ui.lines.join('\n');
    expect(output).toContain('No macOS font catalogs found.');
    expect(output).toContain('fontist import macos --plist');
  });

  it('uninstall prints removal output and supports the remove alias', async () => {
    await freshEnv();
    await run(argv('install "Cli Sans" -a -p'));
    env.ui.lines.length = 0;
    expect(await run(argv('remove "Cli Sans"'))).toBe(0);
    const output = env.ui.lines.join('\n');
    expect(output).toContain('These fonts are removed:');
    expect(output).toContain('CliSans-Regular.ttf');
  });

  it('status with no installed fonts prints No font is installed and exits 3', async () => {
    // The windows platform's font directories never exist on POSIX machines,
    // so the installed-font search is genuinely empty here.
    if (env) await cleanup(env);
    env = await testEnv({ platform: 'windows' });
    envs.push(env);
    await writeFormula(env, 'cli_sans', {
      name: 'Cli Sans Formula',
      fonts: [
        { name: 'Cli Sans', styles: [{ family_name: 'Cli Sans', type: 'Regular', full_name: 'Cli Sans Regular', font: 'CliSans-Regular.ttf' }] },
      ],
      resources: { 'cli.zip': { urls: [`${baseUrl}/cli.zip`] } },
    });
    env.ui.lines.length = 0;
    expect(
      await runCli(
        argv('status'),
        { FONTIST_PATH: env.ctx.paths.fontistPath(), FONTIST_PLATFORM_OVERRIDE: 'windows' } as NodeJS.ProcessEnv,
        env.ui,
      ),
    ).toBe(3);
    expect(env.ui.lines.join('\n')).toContain('No font is installed.');
  });

  it('update prints the success message against a local remote', async () => {
    const { promisify } = await import('node:util');
    const execFile = promisify((await import('node:child_process')).execFile);
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const remote = await fsp.mkdtemp(await import('node:path').then((p) => p.join(os.tmpdir(), 'cli-remote-')));
    await execFile('git', ['init', '--bare', '-b', 'v5', remote]);
    const seed = await fsp.mkdtemp(await import('node:path').then((p) => p.join(os.tmpdir(), 'cli-seed-')));
    await execFile('git', ['init', '-b', 'v5'], { cwd: seed });
    await execFile('git', ['config', 'user.email', 'spec@example.com'], { cwd: seed });
    await execFile('git', ['config', 'user.name', 'Spec'], { cwd: seed });
    await fsp.mkdir(await import('node:path').then((p) => p.join(seed, 'Formulas')), { recursive: true });
    await fsp.writeFile(
      await import('node:path').then((p) => p.join(seed, 'Formulas', 'cli_sans.yml')),
      'name: Cli Sans\nfonts:\n- name: Cli Sans\n  styles:\n  - family_name: Cli Sans\n    type: Regular\n    font: CliSans-Regular.ttf\n',
    );
    await execFile('git', ['add', 'Formulas/cli_sans.yml'], { cwd: seed });
    await execFile('git', ['commit', '-m', 'seed'], { cwd: seed });
    await execFile('git', ['push', remote, 'v5'], { cwd: seed });

    // A clean env: pre-existing formulas in the repo path would make update()
    // treat the directory as an existing (non-git) checkout.
    if (env) await cleanup(env);
    env = await testEnv();
    envs.push(env);
    env.ui.lines.length = 0;
    const code = await runCli(
      argv('update'),
      {
        FONTIST_PATH: env.ctx.paths.fontistPath(),
        FONTIST_FORMULAS_REPO_URL: remote,
        FONTIST_FORMULAS_REPO_BRANCH: 'v5',
      } as NodeJS.ProcessEnv,
      env.ui,
    );
    expect(code).toBe(0);
    expect(env.ui.lines.join('\n')).toContain('Formulas have been successfully updated.');
    await fsp.rm(remote, { recursive: true, force: true });
    await fsp.rm(seed, { recursive: true, force: true });
  });

  it('find --variable lists variable resources as JSON', async () => {
    await freshEnv();
    await writeFormula(env, 'mono_var', {
      name: 'Mono Var',
      schema_version: 5,
      fonts: [
        { name: 'Mono Var', styles: [{ family_name: 'Mono Var', type: 'Regular', font: 'MonoVar.ttf' }] },
      ],
      resources: {
        var_ttf: { urls: ['https://example.invalid/v.ttf'], format: 'ttf', variable_axes: ['wght'] },
      },
    });
    env.ui.lines.length = 0;
    expect(await run(argv('find --variable --json'))).toBe(0);
    const parsed = JSON.parse(env.ui.lines.join('\n')) as { name: string; axes: string[] }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: 'Mono Var', resource: 'var_ttf', axes: ['wght'] });
  });

  it('find without a selector errors', async () => {
    await freshEnv();
    expect(await run(argv('find'))).toBe(1);
    expect(env.ui.lines.join('\n')).toContain('Please specify --axes, --variable, or --category');
  });

  it('manifest locations reports installed font paths', async () => {
    await freshEnv();
    await run(argv('install "Cli Sans" -a -p'));
    const manifestPath = path.join(env.home, 'manifest.yml');
    await fsp.writeFile(manifestPath, 'Cli Sans:\n  styles:\n    - Regular\n');
    env.ui.lines.length = 0;
    const code = await run(argv(`manifest locations ${manifestPath}`));
    expect(code).toBe(0);
    const output = env.ui.lines.join('\n');
    expect(output).toContain('CliSans-Regular.ttf');
    expect(output).toContain('"type": "Regular"');
  });

  it('manifest install exits 5 for a missing manifest file', async () => {
    await freshEnv();
    const code = await run(argv(`manifest install ${path.join(env.home, 'missing.yml')}`));
    expect(code).toBe(5);
  });

  it('fontconfig update runs fc-cache via PATH', async () => {
    await freshEnv();
    const bin = path.join(env.home, 'bin');
    const marker = path.join(env.home, 'fc-cache-ran');
    await fsp.mkdir(bin, { recursive: true });
    const script = path.join(bin, 'fc-cache');
    await fsp.writeFile(script, `#!/bin/sh\ntouch "${marker}"\n`);
    await fsp.chmod(script, 0o755);
    const code = await runCli(
      argv('fontconfig update'),
      { FONTIST_PATH: env.ctx.paths.fontistPath(), PATH: bin } as NodeJS.ProcessEnv,
      env.ui,
    );
    expect(code).toBe(0);
    await expect(fsp.access(marker)).resolves.toBeUndefined();
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
