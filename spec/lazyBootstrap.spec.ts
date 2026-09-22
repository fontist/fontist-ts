import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Font } from '../src/api/font.js';
import { createContext } from '../src/context.js';
import { MissingFontError, UnsupportedFontError } from '../src/errors/errors.js';
import { cleanup, testEnv, type TestEnv } from './helpers/index.js';

const run = promisify(execFile);

let remoteDir: string;
const envs: TestEnv[] = [];

async function git(cwd: string, args: string): Promise<void> {
  await run('git', args.split(' '), { cwd });
}

beforeAll(async () => {
  remoteDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-bootstrap-remote-'));
  await git(remoteDir, 'init --bare -b v5');
  const seed = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-bootstrap-seed-'));
  await git(seed, 'init -b v5');
  await git(seed, 'config user.email spec@example.com');
  await git(seed, 'config user.name Spec');
  await fsp.mkdir(path.join(seed, 'Formulas'), { recursive: true });
  await fsp.writeFile(
    path.join(seed, 'Formulas', 'bootstrap_font.yml'),
    'name: Bootstrap Font\n' +
      'fonts:\n' +
      '- name: Bootstrap Font\n' +
      '  styles:\n' +
      '  - family_name: Bootstrap Font\n' +
      '    type: Regular\n' +
      '    font: BootstrapFont.ttf\n' +
      'resources:\n' +
      '  b.zip:\n' +
      '    urls:\n' +
      '    - https://example.invalid/b.zip\n',
  );
  await git(seed, 'add Formulas/bootstrap_font.yml');
  await git(seed, 'commit -m seed');
  await git(seed, `push ${remoteDir} v5`);
  await fsp.rm(seed, { recursive: true, force: true });
});

afterAll(async () => {
  await fsp.rm(remoteDir, { recursive: true, force: true }).catch(() => undefined);
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

function bootstrapEnv(): Promise<TestEnv> {
  return testEnv();
}

describe('lazy formulas bootstrap', () => {
  it('auto-clones the formulas repo on first font lookup', async () => {
    const env = await bootstrapEnv();
    envs.push(env);
    await expect(fsp.access(env.ctx.paths.formulasRepoPath())).rejects.toBeTruthy();
    const ctx = await createContext(
      {
        FONTIST_PATH: env.ctx.paths.fontistPath(),
        FONTIST_FORMULAS_REPO_URL: remoteDir,
        FONTIST_FORMULAS_REPO_BRANCH: 'v5',
      } as NodeJS.ProcessEnv,
      { ui: env.ui, platform: 'macos' },
    );

    await expect(Font.find('Bootstrap Font', ctx)).rejects.toBeInstanceOf(MissingFontError);

    const formulasYml = path.join(ctx.paths.formulasPath(), 'bootstrap_font.yml');
    await expect(fsp.access(formulasYml)).resolves.toBeUndefined();
  });

  it('survives an unreachable formulas remote with a warning', async () => {
    const env = await testEnv();
    envs.push(env);
    const ctx = await createContext(
      {
        FONTIST_PATH: env.ctx.paths.fontistPath(),
        FONTIST_FORMULAS_REPO_URL: path.join(env.home, 'no-such-remote.git'),
        FONTIST_FORMULAS_REPO_BRANCH: 'v5',
      } as NodeJS.ProcessEnv,
      { ui: env.ui, platform: 'macos' },
    );
    await expect(Font.find('Bootstrap Font', ctx)).rejects.toBeInstanceOf(UnsupportedFontError);
    expect(env.ui.lines.join('\n')).toContain('Formulas repository is not available');
  });

  it('respects FONTIST_FORMULAS_REPO_BRANCH', async () => {
    const env = await testEnv();
    envs.push(env);
    // A nonexistent branch makes the clone fail, proving the branch
    // override is passed through to git instead of the default v5.
    const ctx = await createContext(
      {
        FONTIST_PATH: env.ctx.paths.fontistPath(),
        FONTIST_FORMULAS_REPO_URL: remoteDir,
        FONTIST_FORMULAS_REPO_BRANCH: 'nonexistent-branch',
      } as NodeJS.ProcessEnv,
      { ui: env.ui, platform: 'macos' },
    );
    await expect(Font.find('Bootstrap Font', ctx)).rejects.toBeInstanceOf(UnsupportedFontError);
    expect(env.ui.lines.join('\n')).toContain('Formulas repository is not available');
  });
});
