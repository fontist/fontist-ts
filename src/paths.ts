import * as path from 'node:path';
import * as os from 'node:os';

export const FORMULAS_VERSION = 'v5';
export const FORMULAS_REPO_URL = 'https://github.com/fontist/formulas.git';

/** All well-known Fontist filesystem locations, rooted at the fontist home
 * (`FONTIST_PATH` or `~/.fontist`). Layout mirrors the Ruby gem so both
 * implementations can share one cache directory. */
export class FontistPaths {
  constructor(
    private readonly root: string,
    private readonly fontsDirOverride: string | null = null,
  ) {}

  static resolve(env: NodeJS.ProcessEnv): FontistPaths {
    const root = env.FONTIST_PATH || path.join(os.homedir(), '.fontist');
    return new FontistPaths(root);
  }

  fontistPath(): string {
    return this.root;
  }

  fontsPath(): string {
    return this.fontsDirOverride ?? path.join(this.root, 'fonts');
  }

  downloadsPath(): string {
    return path.join(this.root, 'downloads');
  }

  /** Import cache (Ruby Fontist.import_cache_path): FONTIST_IMPORT_CACHE or
   * `<fontist home>/import_cache`. */
  importCachePath(env: NodeJS.ProcessEnv = process.env): string {
    return env.FONTIST_IMPORT_CACHE || path.join(this.root, 'import_cache');
  }

  versionsPath(): string {
    return path.join(this.root, 'versions', FORMULAS_VERSION);
  }

  formulasRepoPath(): string {
    return path.join(this.versionsPath(), 'formulas');
  }

  formulasPath(): string {
    return path.join(this.formulasRepoPath(), 'Formulas');
  }

  privateFormulasPath(): string {
    return path.join(this.formulasPath(), 'private');
  }

  configYmlPath(): string {
    return path.join(this.root, 'config.yml');
  }

  formulaIndexDir(): string {
    return this.versionsPath();
  }

  formulaDefaultFamilyIndexPath(): string {
    return path.join(this.formulaIndexDir(), 'formula_index.default_family.yml');
  }

  formulaPreferredFamilyIndexPath(): string {
    return path.join(this.formulaIndexDir(), 'formula_index.preferred_family.yml');
  }

  formulaFilenameIndexPath(): string {
    return path.join(this.formulaIndexDir(), 'filename_index.yml');
  }

  fontistIndexPath(): string {
    return path.join(this.root, 'fontist_index.default_family.yml');
  }

  userIndexPath(): string {
    return path.join(this.root, 'user_index.default_family.yml');
  }

  systemIndexPath(): string {
    return path.join(this.root, 'system_index.default_family.yml');
  }
}
