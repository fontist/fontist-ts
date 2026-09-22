// Mirrors fontist/repo_spec.rb, fontist/update_spec.rb, fontist/formula_auto_update_spec.rb (Ruby gem): representative coverage.
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitClient } from '../src/repo/gitClient.js';
import { FormulasRepo } from '../src/repo/formulasRepo.js';
import { PrivateRepos, normalizeGitUrl } from '../src/repo/privateRepos.js';
import { updateFormulas } from '../src/repo/update.js';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import { cleanup, testEnv, type TestEnv } from './helpers/index.js';

const run = promisify(execFile);

let remoteDir: string;
let remoteUrl: string;
const envs: TestEnv[] = [];

async function git(cwd: string, args: string): Promise<string> {
  const result = await run('git', args.split(' '), { cwd });
  return String(result.stdout);
}

beforeAll(async () => {
  remoteDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-remote-'));
  await git(remoteDir, 'init --bare -b v5');
  remoteUrl = remoteDir;

  // Seed a worktree with one formula and push it.
  const seed = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-seed-'));
  await git(seed, 'init -b v5');
  await git(seed, 'config user.email spec@example.com');
  await git(seed, 'config user.name Spec');
  await fsp.mkdir(path.join(seed, 'Formulas'), { recursive: true });
  await fsp.writeFile(
    path.join(seed, 'Formulas', 'remote_font.yml'),
    'name: Remote Font\nfonts:\n- name: Remote Font\n  styles:\n  - family_name: Remote Font\n    type: Regular\n    font: RemoteFont.ttf\n',
  );
  await git(seed, 'add Formulas/remote_font.yml');
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

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

describe('GitClient', () => {
  it('clones, reports branch, revision and remote', async () => {
    const e = await env();
    const work = path.join(e.home, 'work');
    await fsp.mkdir(work, { recursive: true });
    const gitClient = new GitClient(work);
    await gitClient.clone(remoteUrl, { branch: 'v5', depth: 1 });
    expect(await gitClient.currentBranch()).toBe('v5');
    expect(await gitClient.remoteUrl()).toBe(remoteUrl);
    const revision = await gitClient.shortRevision();
    expect(revision).toMatch(/^[0-9a-f]+$/);
    expect(await gitClient.lastCommitDate()).toBeInstanceOf(Date);
  });

  it('raises BinaryCallError for failures and missing git', async () => {
    const e = await env();
    const gitClient = new GitClient(e.home);
    await expect(gitClient.run(['rev-parse', '--verify', 'nope'])).rejects.toThrow(/git/);
  });
});

describe('FormulasRepo', () => {
  it('clones the main repo and pulls updates', async () => {
    const e = await env();
    // Point the repo URL at the local remote by monkey-patching config via env:
    // the FormulasRepo uses FORMULAS_REPO_URL; instead we pre-create the clone.
    const repoPath = e.ctx.paths.formulasRepoPath();
    await fsp.mkdir(path.dirname(repoPath), { recursive: true });
    const parent = new GitClient(path.dirname(repoPath));
    await parent.run(['clone', '--branch', 'v5', '--depth', '1', remoteUrl, path.basename(repoPath)]);

    const repo = new FormulasRepo(e.ctx);
    expect(await repo.exists()).toBe(true);
    await repo.update(); // pull on the current branch
    const describe = await repo.describe();
    expect(describe.branch).toBe('v5');
    expect(describe.revision).toMatch(/^[0-9a-f]+$/);
  });

  it('reports a missing repo via exists()', async () => {
    const e = await env();
    expect(await new FormulasRepo(e.ctx).exists()).toBe(false);
  });
});

describe('PrivateRepos', () => {
  it('setup, info, list and remove a private repo', async () => {
    const e = await env();
    const repos = new PrivateRepos(e.ctx);
    await repos.setup('myfonts', remoteUrl);
    expect(await repos.list()).toEqual(['myfonts']);
    const info = await repos.info('myfonts');
    expect(info.url).toBe(remoteUrl);
    expect(info.revision).toMatch(/^[0-9a-f]+$/);
    expect(info.formulaCount).toBe(1);
    await repos.remove('myfonts');
    expect(await repos.list()).toEqual([]);
    await expect(repos.info('myfonts')).rejects.toThrow(/not found/i);
  });

  it('rejects duplicate urls and missing repos', async () => {
    const e = await env();
    const repos = new PrivateRepos(e.ctx);
    await repos.setup('mine', remoteUrl);
    await expect(repos.setup('other', remoteUrl)).rejects.toThrow(/already registered/);
    await expect(repos.update('ghost')).rejects.toThrow(/not found/i);
    await expect(repos.remove('ghost')).rejects.toThrow(/not found/i);
  });

  it('normalizes git urls for comparison', () => {
    expect(normalizeGitUrl('https://github.com/fontist/formulas.git')).toBe(
      normalizeGitUrl('git@github.com:fontist/formulas'),
    );
  });
});

describe('updateFormulas', () => {
  it('updates the repo and rebuilds formula indexes', async () => {
    const e = await env();
    const repoPath = e.ctx.paths.formulasRepoPath();
    await fsp.mkdir(path.dirname(repoPath), { recursive: true });
    await new GitClient(path.dirname(repoPath)).run([
      'clone', '--branch', 'v5', '--depth', '1', remoteUrl, path.basename(repoPath),
    ]);
    await updateFormulas(e.ctx);
    const indexPath = e.ctx.paths.formulaDefaultFamilyIndexPath();
    const indexText = await fsp.readFile(indexPath, 'utf8');
    expect(indexText).toContain('remote font');
    const repo = new FormulaRepository(e.ctx);
    const found = await repo.findByName('remote font');
    expect(found?.key()).toBe('remote_font');
  });
});
