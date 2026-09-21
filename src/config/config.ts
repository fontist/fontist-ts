import * as yaml from 'yaml';
import { InvalidConfigAttributeError } from '../errors/errors.js';
import { atomicWriteFile } from '../util/fsx.js';

export interface ConfigValues {
  fonts_path?: string | null;
  google_fonts_key?: string | null;
  open_timeout?: number | null;
  read_timeout?: number | null;
  continue_on_checksum_mismatch?: boolean | null;
  use_system_index?: boolean | null;
  preferred_family?: boolean | null;
  update_fontconfig?: boolean | null;
  no_progress?: boolean | null;
  fonts_install_location?: 'fontist' | 'user' | 'system' | null;
  user_fonts_path?: string | null;
  system_fonts_path?: string | null;
}

export type ConfigKey = keyof ConfigValues;

const KNOWN_KEYS: readonly ConfigKey[] = [
  'fonts_path',
  'google_fonts_key',
  'open_timeout',
  'read_timeout',
  'continue_on_checksum_mismatch',
  'use_system_index',
  'preferred_family',
  'update_fontconfig',
  'no_progress',
  'fonts_install_location',
  'user_fonts_path',
  'system_fonts_path',
];

export function isConfigKey(key: string): key is ConfigKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

export interface ConfigEnvironment {
  FONTIST_PATH?: string;
  FONTIST_INSTALL_LOCATION?: string;
  FONTIST_USER_FONTS_PATH?: string;
  FONTIST_SYSTEM_FONTS_PATH?: string;
  [key: string]: string | undefined;
}

const DEFAULTS: Readonly<Partial<ConfigValues>> = {
  open_timeout: 60,
  read_timeout: 60,
};

/** Fontist configuration: config.yml values + env overrides + defaults. */
export class Config {
  private constructor(private custom: Partial<ConfigValues>) {}

  /** Precedence: env > config file > default. */
  static load(fileValues: Partial<ConfigValues> | null, env: ConfigEnvironment = {}): Config {
    const merged: Partial<ConfigValues> = { ...fileValues };
    const envInstallLocation = env.FONTIST_INSTALL_LOCATION;
    if (
      envInstallLocation === 'fontist' ||
      envInstallLocation === 'user' ||
      envInstallLocation === 'system'
    ) {
      merged.fonts_install_location = envInstallLocation;
    }
    const envUserFonts = env.FONTIST_USER_FONTS_PATH;
    if (envUserFonts) merged.user_fonts_path = envUserFonts;
    const envSystemFonts = env.FONTIST_SYSTEM_FONTS_PATH;
    if (envSystemFonts) merged.system_fonts_path = envSystemFonts;
    return new Config(merged);
  }

  static async fromFile(configPath: string, env: ConfigEnvironment = {}): Promise<Config> {
    let fileValues: Partial<ConfigValues> = {};
    try {
      const text = await import('../util/fsx.js').then((m) => m.readTextFile(configPath));
      const parsed = yaml.parse(text);
      if (parsed && typeof parsed === 'object') {
        fileValues = normalizeFileValues(parsed as Record<string, unknown>);
      }
    } catch {
      fileValues = {};
    }
    return Config.load(fileValues, env);
  }

  get<K extends ConfigKey>(key: K): ConfigValues[K] {
    const value = this.custom[key];
    if (value !== undefined && value !== null) {
      return value;
    }
    return (DEFAULTS[key] ?? null) as ConfigValues[K];
  }

  set(key: ConfigKey, value: ConfigValues[ConfigKey]): void {
    if (!isConfigKey(key)) throw new InvalidConfigAttributeError(key);
    this.custom[key] = value as never;
  }

  delete(key: ConfigKey): void {
    delete this.custom[key];
  }

  customValues(): Partial<ConfigValues> {
    return { ...this.custom };
  }

  async save(configPath: string): Promise<void> {
    await atomicWriteFile(configPath, yaml.stringify(this.customValues(), { lineWidth: 80 }));
  }
}

function normalizeFileValues(raw: Record<string, unknown>): Partial<ConfigValues> {
  const result: Partial<ConfigValues> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isConfigKey(key) && value !== undefined) {
      result[key] = value as never;
    }
  }
  return result;
}
