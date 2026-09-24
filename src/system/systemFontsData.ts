import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';

/** One per-OS scan pattern from the Ruby gem's `system.yml`, verbatim:
 * the glob prefix (with `{username}` placeholder) plus the extension set
 * from the trailing brace expression. */
export interface SystemFontPattern {
  /** Globby directory base the scanner walks (may contain mid-segment
   * stars, as in the MobileAsset and Microsoft app patterns). */
  base: string;
  /** Leading segments before the first wildcard (the monitored set). */
  literalBase: string;
  /** Allowed filename extensions (lowercase, no dot). */
  extensions: string[];
  /** The raw pattern line, kept for debugging parity. */
  raw: string;
}

/** Extensions used when a pattern line omits the brace expression. */
const DEFAULT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'];

/** Parses a system.yml pattern line: a glob prefix plus an optional
 * trailing brace expression listing allowed extensions. */
function parsePattern(raw: string): SystemFontPattern {
  const brace = raw.match(/\.\{([^}]+)\}$/);
  const extensions = brace
    ? brace[1]!.split(',').map((e) => e.trim().toLowerCase())
    : DEFAULT_EXTENSIONS;
  const noBrace = (brace ? raw.slice(0, raw.length - brace[0].length) : raw).replace(/\/+$/, '');
  const segments = noBrace.split('/');
  while (segments.length > 1 && segments[segments.length - 1] === '**') segments.pop();
  const globBase = segments.join('/');
  const literal: string[] = [];
  for (const segment of segments) {
    if (segment.includes('*')) break;
    literal.push(segment);
  }
  return { base: globBase, literalBase: literal.join('/'), extensions, raw };
}

const SYSTEM_FONT_PATTERNS: Record<string, string[]> = {
  linux: ['/usr/share/fonts/**/**.{ttf,ttc}'],
  windows: [
    'C:/Windows/Fonts/**/**.{ttf,otf,ttc,otc}',
    'C:/WINDOWS/Fonts/**/**.{ttf,otf,ttc,otc}',
    'C:/Users/{username}/AppData/Local/Microsoft/Windows/Fonts/**/**.{ttf,otf,ttc,otc}',
    'C:/Program Files/Common Files/Microsoft/**/*.{ttf,otf,ttc,otc}',
    'C:/Program Files (x86)/Common Files/Microsoft/**/*.{ttf,otf,ttc,otc}',
  ],
  macos: [
    '/Library/Fonts/**/**.{ttf,ttc}',
    '/System/Library/Fonts/**/**.{ttf,ttc}',
    '/Users/{username}/Library/Fonts/**.{ttf,ttc}',
    '/Applications/Microsoft**/Contents/Resources/**/**.{ttf,ttc}',
    '/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*.asset/AssetData/**.{ttf,ttc,otf,otc}',
    '/System/Library/PrivateFrameworks/FontServices.framework/Resources/Fonts/Subsets/**/**.{ttf,ttc,otf}',
    '/System/Library/PrivateFrameworks/FontServices.framework/Resources/Fonts/ApplicationSupport/**/**.{ttf,ttc,otf}',
  ],
  unix: ['/usr/share/fonts/**/**.{ttf,ttc}'],
};

/** Filenames Fontist must ignore when scanning system font directories
 * (the Ruby gem's `exclude.yml`). */
const EXCLUDED_FONTS: readonly string[] = ['NISC18030.ttf'];

/** Per-OS patterns, parsed (Ruby system.yml — verbatim data). */
export function systemFontPatterns(platform: string): SystemFontPattern[] {
  return (SYSTEM_FONT_PATTERNS[platform] ?? []).map(parsePattern);
}

/** Legacy dir-view of the patterns (first path segment before wildcards). */
export function systemFontDirPatterns(platform: string): string[] {
  return systemFontPatterns(platform).map((pattern) => pattern.base);
}

export function isExcludedFont(fileName: string): boolean {
  return EXCLUDED_FONTS.includes(fileName);
}

function expandPatternValue(value: string, ctx: FontistContext): string {
  let expanded = value;
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

/** Base directories of the configured system font patterns (the part before
 * the first wildcard), used as the monitored set for index change detection
 * (Ruby `extract_font_directories`). */
export function systemTemplateBaseDirs(ctx: FontistContext): string[] {
  const dirs = systemFontPatterns(ctx.platform)
    .map((pattern) => expandPatternValue(pattern.literalBase, ctx))
    .filter((dir) => dir.length > 0 && !dir.includes('%') && !dir.includes('*'));
  return Array.from(new Set(dirs));
}

export interface SystemFontScanTarget {
  dir: string;
  extensions?: string[];
}

/** Process-wide memo of expanded scan targets, mirroring Ruby's
 * `SystemFont.@system_font_paths ||= ...` memoization. Keyed by platform
 * plus the username/env inputs the patterns consume. */
const scanTargetsCache = new Map<string, SystemFontScanTarget[]>();

/** Test/refresh hook (Ruby reset_system_font_paths_cache). */
export function resetSystemFontPathsCache(): void {
  scanTargetsCache.clear();
}

function scanTargetsCacheKey(ctx: FontistContext): string {
  return JSON.stringify([ctx.platform, username(), ctx.env['FONTIST_PATH'] ?? null]);
}

/** Expands each configured pattern into concrete scan targets: the glob
 * prefix (`Microsoft**`, `Font*`, `{username}`) is resolved against the
 * filesystem; missing targets are dropped, as in Ruby's `Dir.glob`. */
export async function systemFontScanTargets(ctx: FontistContext): Promise<SystemFontScanTarget[]> {
  const key = scanTargetsCacheKey(ctx);
  const cached = scanTargetsCache.get(key);
  if (cached) return cached;
  const targets: SystemFontScanTarget[] = [];
  for (const pattern of systemFontPatterns(ctx.platform)) {
    const base = expandPatternValue(pattern.base, ctx);
    for (const dir of await globPrefix(base)) {
      if (await isDirectory(dir)) {
        targets.push({ dir, extensions: pattern.extensions });
      }
    }
  }
  scanTargetsCache.set(key, targets);
  return targets;
}

/** Resolves the directory-glob prefix of a pattern to concrete dirs.
 * Supports `**` (any depth), `*` (one segment), and literal prefixes. */
async function globPrefix(base: string): Promise<string[]> {
  if (!base.includes('*')) return [base];
  const segments = base.split('/');
  let current: string[] = ['/'];
  for (const segment of segments) {
    if (segment === '') continue;
    const next: string[] = [];
    for (const dir of current) {
      if (!segment.includes('*')) {
        next.push(path.join(dir, segment));
        continue;
      }
      const regex = segmentRegex(segment);
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && regex.test(entry.name)) {
          next.push(path.join(dir, entry.name));
        }
      }
    }
    current = next;
  }
  return current;
}

/** Pattern stars match names starting with the literal prefix within one
 * directory segment (Ruby Dir.glob semantics for real font layouts). */
function segmentRegex(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = escaped.replaceAll('*', '[^/]*');
  return new RegExp(`^${source}$`, 'i');
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Directories to scan for system fonts (legacy shape used by callers). */
export async function systemFontPaths(ctx: FontistContext): Promise<string[]> {
  const targets = await systemFontScanTargets(ctx);
  return targets.map((target) => target.dir);
}
