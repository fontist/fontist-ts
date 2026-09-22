import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { FORMULAS_REPO_URL, FORMULAS_VERSION } from '../paths.js';
import { RepoCouldNotBeUpdatedError } from '../errors/errors.js';
import { GitClient } from './gitClient.js';

/** Manages the main formulas repository clone at
 * `versions/v5/formulas`. Remote and branch default to fontist/formulas@v5
 * and can be redirected for mirrors and air-gapped installs. */
export class FormulasRepo {
  private readonly ctx: FontistContext;
  private readonly url: string;
  private readonly branch: string;

  constructor(ctx: FontistContext) {
    this.ctx = ctx;
    this.url = ctx.env.FONTIST_FORMULAS_REPO_URL || FORMULAS_REPO_URL;
    this.branch = ctx.env.FONTIST_FORMULAS_REPO_BRANCH || FORMULAS_VERSION;
  }

  /** Clones the repository when it is missing (Ruby's lazy bootstrap).
   * Clone failures are warned and swallowed: the following font lookup
   * produces the meaningful error, and offline behavior stays unchanged. */
  async ensure(): Promise<void> {
    if (await this.exists()) return;
    try {
      await this.update();
    } catch (err) {
      this.ctx.ui.warn(
        `Formulas repository is not available (${String(err)}); ` +
          'run `fontist update` to initialize it.',
      );
    }
  }

  repoPath(): string {
    return this.ctx.paths.formulasRepoPath();
  }

  async exists(): Promise<boolean> {
    try {
      await fsp.access(path.join(this.repoPath(), 'Formulas'));
      return true;
    } catch {
      return false;
    }
  }

  /** Ensures the repo is cloned and up to date; recreates the origin remote
   * when the clone is missing it (mirrors Ruby's Update flow). */
  async update(): Promise<void> {
    const branch = this.branch;
    const url = this.url;
    await fsp.mkdir(path.dirname(this.repoPath()), { recursive: true });
    const git = new GitClient(this.repoPath());
    try {
      if (!(await this.exists())) {
        const alreadyCloned = await fsp
          .access(path.join(this.repoPath(), '.git'))
          .then(() => true)
          .catch(() => false);
        if (alreadyCloned) {
          await git.fetch(url);
        } else {
          const fresh = new GitClient(path.dirname(this.repoPath()));
          await fresh.run(['clone', '--branch', branch, '--depth', '1', url, path.basename(this.repoPath())]);
        }
        return;
      }
      const currentBranch = await git.currentBranch();
      if (currentBranch === branch) {
        await git.pull('origin', branch);
        return;
      }
      await git.setConfig('remote.origin.fetch', `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      await git.fetch('origin');
      await git.checkout(branch);
      await git.pull('origin', branch);
    } catch (err) {
      if (err instanceof RepoCouldNotBeUpdatedError) throw err;
      throw new RepoCouldNotBeUpdatedError(
        `Formulas repository could not be updated: ${String(err)}`,
      );
    }
  }

  async describe(): Promise<{
    url: string | null;
    branch: string | null;
    revision: string | null;
    updatedAt: Date | null;
  }> {
    const git = new GitClient(this.repoPath());
    const [url, branch, revision, updatedAt] = await Promise.all([
      git.remoteUrl(),
      git.currentBranch(),
      git.shortRevision(),
      git.lastCommitDate(),
    ]);
    return { url, branch, revision, updatedAt };
  }
}

/** Lazily bootstraps the formulas repository (no-op when present). */
export async function ensureFormulasAvailable(ctx: FontistContext): Promise<void> {
  await new FormulasRepo(ctx).ensure();
}
