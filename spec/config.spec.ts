// Mirrors fontist/config_spec.rb, fontist/utils/system_platform_override_spec.rb (Ruby gem): representative coverage.
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Config } from '../src/config/config.js';
import { FontistPaths, FORMULAS_VERSION } from '../src/paths.js';
import { resolvePlatform } from '../src/context.js';
import { InvalidConfigAttributeError } from '../src/errors/errors.js';
import { cleanup, testEnv } from './helpers/index.js';

describe('Config', () => {
  it('applies defaults when nothing is set', () => {
    const config = Config.load(null, {});
    expect(config.get('open_timeout')).toBe(60);
    expect(config.get('read_timeout')).toBe(60);
    expect(config.get('fonts_install_location')).toBeNull();
  });

  it('prefers env values over config-file values', () => {
    const config = Config.load(
      { fonts_install_location: 'fontist', user_fonts_path: '/from/file' },
      { FONTIST_INSTALL_LOCATION: 'system', FONTIST_USER_FONTS_PATH: '/from/env' },
    );
    expect(config.get('fonts_install_location')).toBe('system');
    expect(config.get('user_fonts_path')).toBe('/from/env');
  });

  it('keeps file values when env is silent', () => {
    const config = Config.load({ fonts_install_location: 'user' }, {});
    expect(config.get('fonts_install_location')).toBe('user');
  });

  it('rejects invalid env install locations', () => {
    const config = Config.load({ fonts_install_location: 'user' }, { FONTIST_INSTALL_LOCATION: 'somewhere' });
    expect(config.get('fonts_install_location')).toBe('user');
  });

  it('persists only custom values and reloads them', async () => {
    const env = await testEnv();
    try {
      const config = env.ctx.config;
      config.set('open_timeout', 30);
      config.set('fonts_install_location', 'user');
      await config.save(env.ctx.paths.configYmlPath());
      const reloaded = await Config.fromFile(env.ctx.paths.configYmlPath(), {});
      expect(reloaded.get('open_timeout')).toBe(30);
      expect(reloaded.get('fonts_install_location')).toBe('user');
      expect(reloaded.get('read_timeout')).toBe(60);
    } finally {
      await cleanup(env);
    }
  });

  it('rejects unknown config keys', () => {
    const config = Config.load(null, {});
    expect(() => config.set('nonsense' as never, 1)).toThrow(InvalidConfigAttributeError);
  });
});

describe('FontistPaths', () => {
  it('lays out the versioned formulas tree like the Ruby gem', () => {
    const paths = new FontistPaths('/home/x/.fontist');
    expect(paths.fontsPath()).toBe(path.join('/home/x/.fontist', 'fonts'));
    expect(paths.downloadsPath()).toBe(path.join('/home/x/.fontist', 'downloads'));
    expect(paths.versionsPath()).toBe(path.join('/home/x/.fontist', 'versions', FORMULAS_VERSION));
    expect(paths.formulasRepoPath()).toBe(
      path.join('/home/x/.fontist', 'versions', FORMULAS_VERSION, 'formulas'),
    );
    expect(paths.formulasPath()).toBe(
      path.join('/home/x/.fontist', 'versions', FORMULAS_VERSION, 'formulas', 'Formulas'),
    );
    expect(paths.formulaDefaultFamilyIndexPath()).toContain('formula_index.default_family.yml');
    expect(paths.formulaFilenameIndexPath()).toContain('filename_index.yml');
  });

  it('honors FONTIST_PATH over the home dir', () => {
    const paths = FontistPaths.resolve({ FONTIST_PATH: '/custom/root' } as NodeJS.ProcessEnv);
    expect(paths.fontistPath()).toBe('/custom/root');
    const fallback = FontistPaths.resolve({} as NodeJS.ProcessEnv);
    expect(fallback.fontistPath()).toContain('.fontist');
  });
});

describe('platform resolution', () => {
  it('overrides the native platform via FONTIST_PLATFORM_OVERRIDE', () => {
    expect(resolvePlatform({ FONTIST_PLATFORM_OVERRIDE: 'linux' } as NodeJS.ProcessEnv, 'darwin')).toBe('linux');
    expect(resolvePlatform({ FONTIST_PLATFORM_OVERRIDE: 'windows' } as NodeJS.ProcessEnv, 'darwin')).toBe('windows');
    expect(resolvePlatform({ FONTIST_PLATFORM_OVERRIDE: 'macos-font7' } as NodeJS.ProcessEnv, 'linux')).toBe('macos');
    expect(resolvePlatform({} as NodeJS.ProcessEnv, 'win32')).toBe('windows');
    expect(resolvePlatform({} as NodeJS.ProcessEnv, 'darwin')).toBe('macos');
    expect(resolvePlatform({} as NodeJS.ProcessEnv, 'linux')).toBe('linux');
  });
});

describe('system font data', () => {
  it('expands user directories and drops missing paths', async () => {
    const env = await testEnv();
    try {
      const { systemFontPaths } = await import('../src/system/systemFontsData.js');
      const paths = await systemFontPaths(env.ctx);
      // On CI/most systems /Library/Fonts and ~/Library/Fonts exist on macOS.
      expect(paths.every((p) => path.isAbsolute(p))).toBe(true);
    } finally {
      await cleanup(env);
    }
  });

  it('scans fixture directories for font files and honors exclusions', async () => {
    const env = await testEnv();
    try {
      const dir = path.join(env.home, 'fonts');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'Good.TTF'), 'x');
      await fsp.writeFile(path.join(dir, 'AlsoGood.otf'), 'x');
      await fsp.writeFile(path.join(dir, 'skip.txt'), 'x');
      await fsp.writeFile(path.join(dir, 'NISC18030.ttf'), 'x');
      const nested = path.join(dir, 'sub');
      await fsp.mkdir(nested);
      await fsp.writeFile(path.join(nested, 'Deep.ttf'), 'x');
      const { scanFontPaths } = await import('../src/system/pathScanning.js');
      const found = await scanFontPaths([dir]);
      const names = found.map((p) => path.basename(p)).sort();
      expect(names).toEqual(['AlsoGood.otf', 'Deep.ttf', 'Good.TTF']);
    } finally {
      await cleanup(env);
    }
  });
});
