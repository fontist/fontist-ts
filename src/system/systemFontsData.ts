import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';

/** Per-OS font search patterns, ported from the Ruby gem's `system.yml`.
 * `{username}` is substituted with the current user's name. */
const SYSTEM_FONT_DIRS: Record<string, string[]> = {
  macos: [
    '/Library/Fonts',
    '/System/Library/Fonts',
    '/System/Library/AssetsV2/com_apple_MobileAsset_Font7/**/*.asset/AssetData',
    '/System/Library/AssetsV2/com_apple_MobileAsset_Font6/**/*.asset/AssetData',
    '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/**/*.asset/AssetData',
    '/System/Library/Fonts/Supplemental',
    '~/Library/Fonts',
    '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
    '/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts',
    '/Applications/Microsoft Excel.app/Contents/Resources/DFonts',
    '/Applications/Sketch.app/Contents/Resources/Fonts',
    '/System/Library/Fonts/FontServices/Supplemental',
  ],
  linux: [
    '/usr/share/fonts/**',
    '/usr/local/share/fonts/**',
    '~/.fonts/**',
    '~/.local/share/fonts/**',
  ],
  windows: [
    'C:/Windows/Fonts',
    'C:/WINDOWS/Fonts',
    'C:/WINNT/Fonts',
    '%LOCALAPPDATA%/Microsoft/Windows/Fonts',
    '%PROGRAMFILES%/Common Files/Microsoft/Shared/Fonts',
    '%PROGRAMFILES(X86)%/Common Files/Microsoft/Shared/Fonts',
  ],
};

/** Filenames Fontist must ignore when scanning system font directories
 * (ported from the Ruby gem's `exclude.yml`). */
const EXCLUDED_FONTS: readonly string[] = ['NISC18030.ttf', 'Oriya Sangam MN.ttc'];

export function systemFontDirPatterns(platform: string): string[] {
  return SYSTEM_FONT_DIRS[platform] ?? [];
}

export function isExcludedFont(fileName: string): boolean {
  return EXCLUDED_FONTS.includes(fileName);
}

/** Resolves the concrete font directories for a context: expands `~`,
 * `{username}`, and Windows environment variables; drops nonexistent dirs. */
export async function systemFontPaths(ctx: FontistContext): Promise<string[]> {
  const patterns = systemFontDirPatterns(ctx.platform);
  const resolved = patterns.map((pattern) => expandPattern(pattern, ctx));
  const existing: string[] = [];
  for (const dir of resolved) {
    if (await isDirectory(dir)) existing.push(dir);
  }
  return existing;
}

function expandPattern(pattern: string, ctx: FontistContext): string {
  let expanded = pattern;
  if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }
  expanded = expanded.replaceAll('{username}', username());
  expanded = expanded.replace(/%([^%]+)%/g, (_match, name: string) => ctx.env[name] ?? '');
  return expanded;
}

function username(): string {
  return os.userInfo().username;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
