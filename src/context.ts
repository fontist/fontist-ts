import { Config, type ConfigEnvironment } from './config/config.js';
import { FontistPaths } from './paths.js';
import { UI } from './ui/ui.js';
import type { FontistPlatform } from './ui/ui.js';

export const FONTIST_VERSION = '1.0.0-alpha.1';

export interface FontistContext {
  config: Config;
  paths: FontistPaths;
  ui: UI;
  env: NodeJS.ProcessEnv;
  platform: FontistPlatform;
}

/** Resolves the effective platform, honoring FONTIST_PLATFORM_OVERRIDE
 * (`macos`, `macos-font<N>`, `linux`, `windows`). */
export function resolvePlatform(env: NodeJS.ProcessEnv, processPlatform: NodeJS.Platform): FontistPlatform {
  const override = env.FONTIST_PLATFORM_OVERRIDE?.toLowerCase();
  if (override) {
    if (override === 'linux') return 'linux';
    if (override === 'windows') return 'windows';
    if (override === 'macos' || override.startsWith('macos-font')) return 'macos';
  }
  return nativePlatform(processPlatform);
}

export function nativePlatform(platform: NodeJS.Platform): FontistPlatform {
  switch (platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

export async function createContext(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    paths?: FontistPaths;
    ui?: UI;
    config?: Config;
    platform?: FontistPlatform;
  } = {},
): Promise<FontistContext> {
  const paths = options.paths ?? FontistPaths.resolve(env);
  const configEnv: ConfigEnvironment = env;
  const config =
    options.config ?? (await Config.fromFile(paths.configYmlPath(), configEnv));
  const ui = options.ui ?? new UI();
  return {
    config,
    paths,
    ui,
    env,
    platform: options.platform ?? resolvePlatform(env, process.platform),
  };
}
