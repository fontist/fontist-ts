// Mirrors spec/fontist/macos_ondemand_fonts_spec.rb,
// spec/fontist/windows_ondemand_fonts_spec.rb, and
// spec/fontist/utils/system/run_powershell_spec.rb (Ruby gem), plus the
// Utils::System behaviors those flows rely on.
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Formula } from '../../src/formula/formula.js';
import type { MacosImportSource } from '../../src/formula/importSources.js';
import { FontInstaller } from '../../src/installer/fontInstaller.js';
import { ResourceInstallerRegistry } from '../../src/installer/resourceInstallers.js';
import {
  PlatformMismatchError,
  WindowsFodInstallError,
} from '../../src/errors/errors.js';
import {
  catalogVersionForMacos,
  defaultRunPowershell,
  macosVersion,
  parseMacosVersion,
  parsePlatformOverride,
  runPowershell,
  versionInRange,
  type RunPowershell,
} from '../../src/system/systemUtils.js';
import { MACOS_FRAMEWORK_METADATA } from '../../src/import/macos/frameworkMetadata.js';
import { writeFormula, testEnv, cleanup, type TestEnv } from '../helpers/index.js';

const MACOS_FORMULA = {
  name: 'Al Bayan',
  description: 'Arabic font from macOS',
  homepage: 'https://support.apple.com/en-us/HT211240',
  platforms: ['macos'],
  resources: {
    al_bayan: {
      source: 'apple_cdn',
      urls: ['https://updates.cdn-apple.com/example/com_apple_MobileAsset_Font7/font.zip'],
      sha256: ['9f4e142e68bcbf161ecfa290da0c65ebc4ef2c0e2aa85ee4f4c6a0e4b8e4b8e4'],
      file_size: 101972,
    },
  },
  fonts: [
    {
      name: 'Al Bayan',
      styles: [
        {
          family_name: 'Al Bayan',
          type: 'Plain',
          font: 'AlBayan.ttc',
          post_script_name: 'AlBayan',
        },
      ],
    },
  ],
  open_license: 'Apple Font License',
};

const WINDOWS_FOD_FORMULA = {
  schema_version: 5,
  name: 'Japanese Fonts',
  description: 'Japanese Fonts for Windows',
  homepage: 'https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list',
  platforms: ['windows'],
  open_license: 'Microsoft font license',
  resources: {
    japanese_fonts: {
      source: 'windows_fod',
      capability_name: 'Language.Fonts.Jpan~~~und-JPAN~0.0.1.0',
    },
  },
  fonts: [
    {
      name: 'Meiryo',
      styles: [{ family_name: 'Meiryo', type: 'Regular', font: 'meiryo.ttc' }],
    },
  ],
  import_source: {
    type: 'windows',
    capability_name: 'Language.Fonts.Jpan~~~und-JPAN~0.0.1.0',
    min_windows_version: '10.0',
  },
};

describe('macOS on-demand formula platform gating', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await testEnv({ platform: 'macos' });
    await writeFormula(env, 'macos/test_al_bayan', MACOS_FORMULA);
  });

  afterAll(async () => {
    await cleanup(env);
  });

  it('finds the formula and recognizes the apple_cdn source', async () => {
    const { FormulaRepository } = await import('../../src/formula/formulaRepository.js');
    const repo = new FormulaRepository(env.ctx);
    const formula = await repo.findByKey('macos/test_al_bayan');
    expect(formula).not.toBeNull();
    expect(formula!.platforms).toEqual(['macos']);
    expect(formula!.source()).toBe('apple_cdn');
    expect(formula!.requiresSystemInstallation()).toBe(true);
  });

  it('allows installation on macOS', async () => {
    const { FormulaRepository } = await import('../../src/formula/formulaRepository.js');
    const formula = await new FormulaRepository(env.ctx).findByKey('macos/test_al_bayan');
    expect(formula!.compatibleWithPlatform('macos')).toBe(true);
  });

  it('blocks installation on Linux and Windows with the Ruby messages', async () => {
    const { FormulaRepository } = await import('../../src/formula/formulaRepository.js');
    const formula = await new FormulaRepository(env.ctx).findByKey('macos/test_al_bayan');

    expect(formula!.compatibleWithPlatform('linux')).toBe(false);
    const message = formula!.platformRestrictionMessage('linux');
    expect(message).toContain('only available for: macos');
    expect(message).toContain('This font cannot be installed on your system.');

    // Ruby's spec mocks user_os to :linux; we hand the installer a linux ctx.
    const linuxCtx = { ...env.ctx, platform: 'linux' as const };
    const installer = new FontInstaller(linuxCtx, formula!);
    await expect(installer.install('yes')).rejects.toThrow(PlatformMismatchError);
    await expect(installer.install('yes')).rejects.toThrow(/only available for: macos/);

    expect(formula!.compatibleWithPlatform('windows')).toBe(false);
  });
});

describe('macOS import framework gating', () => {
  it('resolves macos version and framework from the platform override', () => {
    const env = { FONTIST_PLATFORM_OVERRIDE: 'macos-font7' };
    expect(parsePlatformOverride(env)).toEqual({ os: 'macos', framework: 7 });
    expect(macosVersion(env)).toBe('12.0');
    expect(catalogVersionForMacos(env)).toBe(7);
  });

  it('parses and range-checks version strings', () => {
    expect(parseMacosVersion('10.11.6')).toBe(101106);
    expect(parseMacosVersion('26.0.0')).toBe(260000);
    expect(parseMacosVersion(null)).toBeNull();
    expect(versionInRange('12.0', '15.99', '13.0')).toBe(true);
    expect(versionInRange('12.0', '15.99', '16.0')).toBe(false);
    expect(versionInRange('12.0', '15.99', null)).toBe(true);
  });

  it('builds the Ruby UnsupportedMacOSVersionError message', async () => {
    const { UnsupportedMacOSVersionError } = await import('../../src/errors/errors.js');
    const error = new UnsupportedMacOSVersionError('16.0', MACOS_FRAMEWORK_METADATA);
    expect(error.message).toContain('Unsupported macOS version: 16.0');
    expect(error.message).toContain('Font7: 12.0-15.99');
    expect(error.message).toContain('Font8: 26.0-+');
    expect(error.message).toContain('FONTIST_PLATFORM_OVERRIDE="macos-font7"');
  });

  it('gates macos-import formulas by framework compatibility', async () => {
    const font7 = new Formula({
      name: 'Font Seven',
      platforms: ['macos-font7'],
      import_source: { type: 'macos', framework_version: 7, posted_date: '2022-04-13', asset_id: 'abc' },
    }) as Formula & { importSource: MacosImportSource };
    const font8 = new Formula({
      name: 'Font Eight',
      platforms: ['macos-font8'],
      import_source: { type: 'macos', framework_version: 8, posted_date: '2025-09-20', asset_id: 'def' },
    }) as Formula & { importSource: MacosImportSource };

    // Override to Font7 (macOS 12): Font7 formula compatible, Font8 not.
    const env = { FONTIST_PLATFORM_OVERRIDE: 'macos-font7' };
    const version = macosVersion(env)!;
    expect(font7.importSource.compatibleWithMacos(version)).toBe(true);
    expect(font8.importSource.compatibleWithMacos(version)).toBe(false);
    expect(
      versionInRange(font8.importSource.minMacosVersion(), font8.importSource.maxMacosVersion(), version),
    ).toBe(false);
  });
});

describe('Windows on-demand FOD resource dispatch', () => {
  let env: TestEnv;
  let windir: string;

  beforeAll(async () => {
    env = await testEnv({ platform: 'windows' });
    windir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-windir-'));
    await fsp.mkdir(path.join(windir, 'Fonts'), { recursive: true });
    await fsp.writeFile(path.join(windir, 'Fonts', 'meiryo.ttc'), Buffer.from('ttc-bytes'));
    // meiryo.ttf intentionally absent: only existing files are delivered.
    (env.ctx.env as Record<string, string>)['windir'] = windir;
  });

  afterAll(async () => {
    await fsp.rm(windir, { recursive: true, force: true });
    await cleanup(env);
  });

  function fodFormula(): Formula {
    return new Formula(WINDOWS_FOD_FORMULA) as Formula;
  }

  it('flags windows_fod formulas', () => {
    const formula = fodFormula();
    expect(formula.source()).toBe('windows_fod');
    expect(formula.platforms).toEqual(['windows']);
  });

  it('installs the capability when missing and yields system fonts', async () => {
    const formula = fodFormula();
    const resource = formula.resources[0]!;
    const commands: string[] = [];
    const powershell: RunPowershell = async (command) => {
      commands.push(command);
      if (command.startsWith('(Get-WindowsCapability')) {
        return { stdout: 'NotPresent\n', stderr: '', success: true };
      }
      return { stdout: '', stderr: '', success: true };
    };

    const registry = new ResourceInstallerRegistry();
    const installer = registry.create('windows_fod', env.ctx, resource, {});
    (
      installer as unknown as { powershell: RunPowershell }
    ).powershell = powershell;

    const delivered: string[] = [];
    await installer.files(['meiryo.ttc', 'meiryo.ttf'], async (filePath) => {
      delivered.push(filePath);
    });

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(
      "(Get-WindowsCapability -Online -Name 'Language.Fonts.Jpan~~~und-JPAN~0.0.1.0').State",
    );
    expect(commands[1]).toBe(
      "Add-WindowsCapability -Online -Name 'Language.Fonts.Jpan~~~und-JPAN~0.0.1.0'",
    );
    expect(delivered).toHaveLength(1);
    expect(path.basename(delivered[0]!)).toBe('meiryo.ttc');
    void windir;
  });

  it('skips installation when the capability is already installed', async () => {
    const formula = fodFormula();
    const resource = formula.resources[0]!;
    const commands: string[] = [];
    const powershell: RunPowershell = async (command) => {
      commands.push(command);
      return { stdout: 'Installed\n', stderr: '', success: true };
    };

    const registry = new ResourceInstallerRegistry();
    const installer = registry.create('windows_fod', env.ctx, resource, {});
    (
      installer as unknown as { powershell: RunPowershell }
    ).powershell = powershell;

    const delivered: string[] = [];
    await installer.files(['meiryo.ttc'], async (filePath) => {
      delivered.push(filePath);
    });

    expect(commands).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });

  it('raises WindowsFodInstallError with the Ruby message on failure', async () => {
    const formula = fodFormula();
    const resource = formula.resources[0]!;
    const powershell: RunPowershell = async (command) => {
      if (command.startsWith('(Get-WindowsCapability')) {
        return { stdout: 'NotPresent\n', stderr: '', success: true };
      }
      return { stdout: '', stderr: 'WSUS blocked the request', success: false };
    };

    const registry = new ResourceInstallerRegistry();
    const installer = registry.create('windows_fod', env.ctx, resource, {});
    (
      installer as unknown as { powershell: RunPowershell }
    ).powershell = powershell;

    let caught: unknown = null;
    try {
      await installer.files(['meiryo.ttc'], async () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsFodInstallError);
    const error = caught as WindowsFodInstallError;
    expect(error.capabilityName).toBe('Language.Fonts.Jpan~~~und-JPAN~0.0.1.0');
    expect(error.message).toContain("Failed to install Windows font capability 'Language.Fonts.Jpan~~~und-JPAN~0.0.1.0'");
    expect(error.message).toContain('WSUS blocked the request');
    expect(error.message).toContain('WSUS/SCCM policy blocking Features on Demand');
  });

  it('escapes single quotes in capability names', async () => {
    const formula = new Formula({
      schema_version: 5,
      name: 'Odd',
      platforms: ['windows'],
      resources: { odd: { source: 'windows_fod', capability_name: "Weird'Name" } },
      fonts: [],
    }) as Formula;
    const resource = formula.resources[0]!;
    const commands: string[] = [];
    const powershell: RunPowershell = async (command) => {
      commands.push(command);
      return { stdout: 'Installed\n', stderr: '', success: true };
    };

    const registry = new ResourceInstallerRegistry();
    const installer = registry.create('windows_fod', env.ctx, resource, {});
    (
      installer as unknown as { powershell: RunPowershell }
    ).powershell = powershell;
    await installer.files([], async () => {});
    expect(commands[0]).toContain("'Weird''Name'");
  });
});

describe('Utils::System.run_powershell', () => {
  it('reports an unsuccessful result when powershell.exe is missing', async () => {
    if (process.platform === 'win32') return; // powershell.exe exists there
    const result = await defaultRunPowershell('Write-Output hi');
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('powershell.exe not found');
    expect(result.stdout).toBe('');
  });

  it('propagates stdout/stderr/success from the injected runner', async () => {
    const result = await runPowershell('anything', async () => ({
      stdout: 'Installed\n',
      stderr: 'boom\n',
      success: true,
    }));
    expect(result).toEqual({ stdout: 'Installed\n', stderr: 'boom\n', success: true });
  });
});
