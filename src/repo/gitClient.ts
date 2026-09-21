import { spawn } from 'node:child_process';
import { BinaryCallError } from '../errors/errors.js';

export interface GitResult {
  stdout: string;
  stderr: string;
}

/** Thin async wrapper over the `git` binary. */
export class GitClient {
  constructor(private readonly cwd: string) {}

  async run(args: string[]): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: this.cwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new BinaryCallError('git binary not found on PATH; install git to manage formulas repositories'));
        } else {
          reject(new BinaryCallError(`git ${args.join(' ')} failed: ${String(err)}`));
        }
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new BinaryCallError(`git ${args.join(' ')} exited with ${code}: ${stderr.trim()}`));
        }
      });
    });
  }

  async runAllowingFailure(args: string[]): Promise<GitResult | null> {
    try {
      return await this.run(args);
    } catch (err) {
      if (err instanceof BinaryCallError && !err.message.includes('not found on PATH')) {
        return null;
      }
      throw err;
    }
  }

  clone(url: string, options: { branch?: string; depth?: number } = {}): Promise<GitResult> {
    const args = ['clone'];
    if (options.branch) args.push('--branch', options.branch);
    if (options.depth) args.push('--depth', String(options.depth));
    args.push(url, '.');
    return this.run(args);
  }

  fetch(remote = 'origin'): Promise<GitResult> {
    return this.run(['fetch', remote]);
  }

  pull(remote = 'origin', branch?: string): Promise<GitResult> {
    return this.run(branch ? ['pull', remote, branch] : ['pull', remote]);
  }

  checkout(ref: string): Promise<GitResult> {
    return this.run(['checkout', ref]);
  }

  async currentBranch(): Promise<string | null> {
    const result = await this.runAllowingFailure(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = result?.stdout.trim();
    return branch && branch.length > 0 ? branch : null;
  }

  setConfig(key: string, value: string): Promise<GitResult> {
    return this.run(['config', key, value]);
  }

  async shortRevision(): Promise<string | null> {
    const result = await this.runAllowingFailure(['log', '-1', '--format=%h']);
    const sha = result?.stdout.trim();
    return sha && sha.length > 0 ? sha : null;
  }

  async lastCommitDate(): Promise<Date | null> {
    const result = await this.runAllowingFailure(['log', '-1', '--format=%cI']);
    const date = result?.stdout.trim();
    return date ? new Date(date) : null;
  }

  async remoteUrl(remote = 'origin'): Promise<string | null> {
    const result = await this.runAllowingFailure(['config', `remote.${remote}.url`]);
    const url = result?.stdout.trim();
    return url && url.length > 0 ? url : null;
  }

  async isDirty(): Promise<boolean> {
    const result = await this.runAllowingFailure(['status', '--porcelain']);
    return (result?.stdout.trim().length ?? 0) > 0;
  }
}
