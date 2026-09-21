import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { RepoCouldNotBeUpdatedError, RepoNotFoundError } from '../errors/errors.js';
import { listSubdirectories } from '../util/fsx.js';
import { GitClient } from './gitClient.js';

export interface RepoInfo {
  name: string;
  url: string | null;
  revision: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  formulaCount: number;
}

function repoPathFor(ctx: FontistContext, name: string): string {
  return path.join(ctx.paths.privateFormulasPath(), name);
}

/** Manages private formulas repositories under `Formulas/private/`. */
export class PrivateRepos {
  private readonly ctx: FontistContext;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
  }

  async setup(name: string, url: string, options: { overwrite?: boolean } = {}): Promise<void> {
    const repoPath = repoPathFor(this.ctx, name);
    await this.ensureNoDuplicateUrl(url);
    try {
      await fsp.access(repoPath);
      if (!options.overwrite) {
        throw new RepoCouldNotBeUpdatedError(
          `Repository "${name}" already exists at ${repoPath}; pass overwrite to replace it.`,
        );
      }
      await fsp.rm(repoPath, { recursive: true, force: true });
    } catch (err) {
      if (err instanceof RepoCouldNotBeUpdatedError) throw err;
    }
    await fsp.mkdir(path.dirname(repoPath), { recursive: true });
    const git = new GitClient(path.dirname(repoPath));
    await git.run(['clone', '--depth', '1', url, repoPath]);
    const repoGit = new GitClient(repoPath);
    // Some private repos publish their default branch under a non-main name;
    // force-checkout main when it exists (Ruby Repo setup quirk).
    const branches = await repoGit.runAllowingFailure(['ls-remote', '--heads', 'origin']);
    if (branches?.stdout.includes('refs/heads/main')) {
      const current = await repoGit.currentBranch();
      if (current !== 'main') {
        await repoGit.setConfig('remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
        await repoGit.fetch('origin');
        await repoGit.checkout('main');
        await repoGit.pull('origin', 'main');
      }
    }
    await this.touchCreatedStamp(repoPath);
  }

  async update(name: string): Promise<void> {
    const repoPath = repoPathFor(this.ctx, name);
    try {
      await fsp.access(repoPath);
    } catch {
      throw new RepoNotFoundError(name);
    }
    const git = new GitClient(repoPath);
    try {
      const branch = (await git.currentBranch()) ?? 'main';
      await git.pull('origin', branch);
    } catch (err) {
      throw new RepoCouldNotBeUpdatedError(
        `Repository "${name}" could not be updated: ${String(err)}`,
      );
    }
  }

  async remove(name: string): Promise<void> {
    const repoPath = repoPathFor(this.ctx, name);
    try {
      await fsp.access(repoPath);
    } catch {
      throw new RepoNotFoundError(name);
    }
    await fsp.rm(repoPath, { recursive: true, force: true });
  }

  async list(): Promise<string[]> {
    const dirs = await listSubdirectories(this.ctx.paths.privateFormulasPath());
    return dirs.map((dir) => path.basename(dir)).sort();
  }

  async info(name: string): Promise<RepoInfo> {
    const repoPath = repoPathFor(this.ctx, name);
    try {
      await fsp.access(repoPath);
    } catch {
      throw new RepoNotFoundError(name);
    }
    const git = new GitClient(repoPath);
    const [url, revision, updatedAt, formulaCount] = await Promise.all([
      git.remoteUrl(),
      git.shortRevision(),
      git.lastCommitDate(),
      this.countFormulas(repoPath),
    ]);
    const created = await this.readCreatedStamp(repoPath);
    return { name, url, revision, createdAt: created, updatedAt, formulaCount };
  }

  private async countFormulas(repoPath: string): Promise<number> {
    const formulasDir = path.join(repoPath, 'Formulas');
    let count = 0;
    const stack = [formulasDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
        else if (entry.name.toLowerCase().endsWith('.yml')) count += 1;
      }
    }
    return count;
  }

  private async ensureNoDuplicateUrl(url: string): Promise<void> {
    const normalized = normalizeGitUrl(url);
    for (const name of await this.list()) {
      const git = new GitClient(repoPathFor(this.ctx, name));
      const existing = await git.remoteUrl();
      if (existing && normalizeGitUrl(existing) === normalized) {
        throw new RepoCouldNotBeUpdatedError(
          `URL ${url} is already registered as repository "${name}".`,
        );
      }
    }
  }

  private async touchCreatedStamp(repoPath: string): Promise<void> {
    await fsp.writeFile(path.join(repoPath, '.fontist-repo-created'), new Date().toISOString());
  }

  private async readCreatedStamp(repoPath: string): Promise<Date | null> {
    try {
      const text = await fsp.readFile(path.join(repoPath, '.fontist-repo-created'), 'utf8');
      const date = new Date(text.trim());
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
}

/** Compares git URLs ignoring scheme, credentials, `.git` suffix and separators. */
export function normalizeGitUrl(url: string): string {
  let value = url.trim();
  value = value.replace(/\.git$/, '');
  value = value.replace(/^(https?|git|ssh):\/\//, '');
  value = value.replace(/^[^@]+@/, '');
  return value.replace(/:/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}
