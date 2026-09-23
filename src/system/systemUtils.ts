import { execFile, execFileSync } from 'node:child_process';
import { macosFrameworkMinVersion, macosFrameworkForMacos, type MacosFrameworkInfo } from '../import/macos/frameworkMetadata.js';
import type { FontistPlatform } from '../ui/ui.js';

export interface PlatformOverride {
  os: FontistPlatform;
  framework: number | null;
}

export interface SystemUi {
  error(message: string): void;
}

/** Parses FONTIST_PLATFORM_OVERRIDE keeping the framework number
 * (`macos-font7` → `{os: 'macos', framework: 7}`); invalid values report an
 * error and yield null (Ruby Utils::System.parse_platform_override). */
export function parsePlatformOverride(
  env: NodeJS.ProcessEnv = process.env,
  ui: SystemUi | null = null,
): PlatformOverride | null {
  const override = env['FONTIST_PLATFORM_OVERRIDE'];
  if (!override) return null;

  const withFramework = override.match(/^(macos|linux|windows)-font(\d+)$/);
  if (withFramework) {
    return { os: withFramework[1] as FontistPlatform, framework: Number.parseInt(withFramework[2]!, 10) };
  }

  if (/^(macos|linux|windows)$/.test(override)) {
    return { os: override as FontistPlatform, framework: null };
  }

  ui?.error(
    `Invalid FONTIST_PLATFORM_OVERRIDE: ${override}\n` +
      "Supported: 'macos-font<N>', 'linux', 'windows'",
  );
  return null;
}

/** The effective user OS, honoring the platform override. */
export function userOs(env: NodeJS.ProcessEnv = process.env, ui: SystemUi | null = null): FontistPlatform {
  const parsed = parsePlatformOverride(env, ui);
  if (parsed) return parsed.os;
  return nativeOs();
}

export function nativeOs(): FontistPlatform {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

/** Current macOS version: override+framework maps to the framework's
 * minimum macOS version; otherwise `sw_vers -productVersion` on macOS,
 * null elsewhere or when the tool is missing. */
export function macosVersion(
  env: NodeJS.ProcessEnv = process.env,
  ui: SystemUi | null = null,
  runCommand: RunCommand = defaultRunCommand,
): string | null {
  const parsed = parsePlatformOverride(env, ui);
  if (parsed?.framework) {
    return macosFrameworkMinVersion(parsed.framework);
  }
  if (userOs(env, ui) !== 'macos') return null;
  try {
    return runCommand('sw_vers', ['-productVersion'])?.trim() ?? null;
  } catch {
    return null;
  }
}

/** "10.11.6" → 101106, "26.0.0" → 260000 (Ruby parse_macos_version). */
export function parseMacosVersion(versionString: string | null): number | null {
  if (!versionString || versionString.trim() === '') return null;
  const parts = versionString.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return major * 10000 + minor * 100 + patch;
}

/** Whether the current macOS version lies within [min, max]; unknown
 * versions allow installation (Ruby version_in_range?). */
export function versionInRange(
  minVersion: string | null,
  maxVersion: string | null,
  current: string | null = macosVersion(),
): boolean {
  if (current === null) return true;
  const currentParsed = parseMacosVersion(current);
  if (currentParsed === null) return true;
  if (minVersion) {
    const minParsed = parseMacosVersion(minVersion);
    if (minParsed !== null && currentParsed < minParsed) return false;
  }
  if (maxVersion) {
    const maxParsed = parseMacosVersion(maxVersion);
    if (maxParsed !== null && currentParsed > maxParsed) return false;
  }
  return true;
}

/** The MobileAsset font framework for this system: the override framework
 * when present, else the newest framework covering the macOS version. */
export function catalogVersionForMacos(
  env: NodeJS.ProcessEnv = process.env,
  ui: SystemUi | null = null,
): number | null {
  const parsed = parsePlatformOverride(env, ui);
  if (parsed?.framework) return parsed.framework;
  const version = macosVersion(env, ui);
  if (!version) return null;
  return macosFrameworkForMacos(version);
}

/** `${os}-${release}` for platform-tag matching (Ruby user_os_with_version). */
export function userOsWithVersion(
  env: NodeJS.ProcessEnv = process.env,
  ui: SystemUi | null = null,
  runCommand: RunCommand = defaultRunCommand,
): string {
  let release = 'unknown';
  try {
    if (userOs(env, ui) === 'windows') {
      release = 'unknown';
    } else {
      release = runCommand('uname', ['-r'])?.trim() ?? 'unknown';
    }
  } catch {
    release = 'unknown';
  }
  return `${userOs(env, ui)}-${release}`;
}

export function matchPlatform(platform: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return userOsWithVersion(env).startsWith(platform);
}

export interface PowerShellResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

export type RunCommand = (command: string, args: string[]) => string | null;
export type RunPowershell = (command: string) => Promise<PowerShellResult>;

function defaultRunCommand(command: string, args: string[]): string | null {
  // execFileSync avoids shell interpolation, matching Ruby backtick
  // semantics without exposing command injection.
  return execFileSync(command, args, { encoding: 'utf8' });
}

/** Runs a PowerShell command (Ruby Utils::System.run_powershell); a missing
 * powershell.exe yields an unsuccessful result rather than throwing. */
export function runPowershell(
  command: string,
  runImpl: RunPowershell = defaultRunPowershell,
): Promise<PowerShellResult> {
  return runImpl(command);
}

export function defaultRunPowershell(command: string): Promise<PowerShellResult> {
  return new Promise<PowerShellResult>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ stdout: '', stderr: 'powershell.exe not found', success: false });
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', success: !err });
      },
    );
  });
}

export type { MacosFrameworkInfo };
