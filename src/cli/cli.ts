#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { createContext, FONTIST_VERSION, type FontistContext, type RuntimeOptions } from '../context.js';
import { FontistPaths } from '../paths.js';
import { FORMULAS_VERSION } from '../paths.js';
import { Font } from '../api/font.js';
import { Manifest } from '../api/manifest.js';
import { isConfigKey } from '../config/config.js';
import { InvalidConfigAttributeError } from '../errors/errors.js';
import { FormatSpec, parseVariableAxes } from '../formula/formatSpec.js';
import { FormulaRepository } from '../formula/formulaRepository.js';
import type { FontMatch } from '../formula/fontFinder.js';
import { FontFinder } from '../formula/fontFinder.js';
import { ensureFormulasAvailable } from '../repo/formulasRepo.js';
import { Fontconfig } from '../fontconfig/fontconfig.js';
import { FormulaIndexRegistry } from '../index/formula/formulaFontIndex.js';
import { FormulasRepo } from '../repo/formulasRepo.js';
import { PrivateRepos } from '../repo/privateRepos.js';
import { updateFormulas } from '../repo/update.js';
import { UI } from '../ui/ui.js';
import { exitCodeFor, sizeLimitHint, STATUS_MISSING_FONT_ERROR, STATUS_SUCCESS, STATUS_UNKNOWN_ERROR } from './exitCodes.js';
import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';

async function fspReadJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

interface CliFlags {
  verbose?: boolean;
  force?: boolean;
  formula?: boolean;
  acceptAllLicenses?: boolean;
  hideLicenses?: boolean;
  noProgress?: boolean;
  version?: string;
  smallest?: boolean;
  newest?: boolean;
  sizeLimit?: string;
  updateFontconfig?: boolean;
  location?: string;
  variableAxes?: string;
  preferVariable?: boolean;
  preferFormat?: string;
  transcodePath?: string;
  keepOriginal?: boolean;
  confirmLicense?: boolean;
  collectionIndex?: string;
  limit?: string;
  dryRun?: boolean;
  name?: string;
  mirror?: string[];
  subdir?: string;
  filePattern?: string;
  namePrefix?: string;
  schemaVersion?: string;
  sourcePath?: string;
  outputPath?: string;
  fontName?: string;
  importCache?: string;
  plist?: string;
  formulasDir?: string;
  interactive?: boolean;
  axes?: string;
  variable?: boolean;
  category?: string;
  json?: boolean;
  format?: string;
  output?: string;
  parallel?: boolean;
  rebuild?: boolean;
  quiet?: boolean;
  cache?: boolean;
  preferredFamily?: boolean;
  formulasPath?: string;
}


let cliEnv: NodeJS.ProcessEnv = process.env;
let cliUi: UI | null = null;
/** Program-level options (commander keeps them off subcommand flags). */
let globalFlags: CliFlags = {};

function mergedFlags(flags: CliFlags): CliFlags {
  return { ...globalFlags, ...flags };
}

function contextOptions(flags: CliFlags): { ui: UI; runtime: Partial<RuntimeOptions> } {
  if (cliUi) {
    return { ui: cliUi, runtime: runtimeOptions(flags) };
  }
  return {
    ui: new UI({ level: flags.verbose ? 'debug' : 'info' }),
    runtime: runtimeOptions(flags),
  };
}

function runtimeOptions(flags: CliFlags): Partial<RuntimeOptions> {
  return {
    quiet: flags.quiet ?? false,
    useCache: flags.cache === false ? false : true,
    preferredFamily: flags.preferredFamily ?? false,
    interactive: flags.interactive === false ? false : true,
  };
}

async function withContext<T>(
  rawFlags: CliFlags,
  fn: (ctx: FontistContext) => Promise<T>,
): Promise<T> {
  const flags = mergedFlags(rawFlags);
  const ctx = await createContext(cliEnv, contextOptions(flags));
  ctx.ui.setLevel(flags.verbose ? 'debug' : flags.quiet ? 'fatal' : 'info');
  if (flags.preferredFamily) {
    ctx.config.setRuntimeOverride('preferred_family', true);
  }
  if (flags.formulasPath) {
    ctx.paths = new FontistPaths(ctx.paths.fontistPath(), null, flags.formulasPath);
  }
  return fn(ctx);
}

function installSpecOptions(command: Command): Command {
  return command
    .option('-f, --force', 'Install even if already installed in system')
    .option('-F, --formula', 'Install whole formula instead of a font')
    .option('-a, --accept-all-licenses', 'Accept all license agreements')
    .option('--confirm-license', 'Accept all license agreements')
    .option('-h, --hide-licenses', 'Hide license texts')
    .option('-p, --no-progress', 'Hide download progress')
    .option('-V, --version <version>', 'Specify particular version of a font')
    .option('-s, --smallest', 'Install the smallest font by size if several')
    .option('-n, --newest', 'Install the newest version of a font if several')
    .option('-S, --size-limit <mb>', 'Upper limit for formula size in MB')
    .option('-u, --update-fontconfig', 'Update fontconfig cache')
    .option('-l, --location <location>', 'Install location: fontist, user, system')
    .option('--format <format>', 'Requested font format (ttf, otf, woff2, ...)')
    .option('--variable-axes <axes>', 'Comma-separated variable font axes (e.g. wght)')
    .option('--prefer-variable', 'Prefer variable fonts')
    .option('--prefer-format <format>', 'Preferred format when multiple available')
    .option('--transcode-path <dir>', 'Directory to save transcoded fonts')
    .option('--keep-original', 'Keep original font after transcoding', true)
    .option('--collection-index <index>', 'Index of the face inside a collection (ttc/otc)');
}

function formatSpecFrom(flags: CliFlags): FormatSpec | null {
  const spec = FormatSpec.fromOptions({
    format: flags.format,
    variableAxes: parseVariableAxes(flags.variableAxes),
    preferVariable: flags.preferVariable ?? false,
    preferFormat: flags.preferFormat ?? null,
    transcodePath: flags.transcodePath ?? null,
    keepOriginal: flags.keepOriginal ?? null,
    collectionIndex: flags.collectionIndex ? Number.parseInt(flags.collectionIndex, 10) : null,
  });
  return spec.hasConstraints() ? spec : null;
}


async function cacheInfo(dirPath: string): Promise<{ size: number; files: number }> {
  if (!existsSync(dirPath)) return { size: 0, files: 0 };
  const entries = await walkFiles(dirPath);
  let size = 0;
  for (const file of entries) {
    size += (await fsp.stat(file)).size;
  }
  return { size, files: entries.length };
}

async function directorySize(dirPath: string): Promise<number> {
  const entries = await walkFiles(dirPath);
  let size = 0;
  for (const file of entries) {
    size += (await fsp.stat(file)).size;
  }
  return size;
}

async function walkFiles(dirPath: string): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(dirPath)) return out;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  await walk(dirPath);
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseSizeLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function locationOption(flags: CliFlags): 'fontist' | 'user' | 'system' | null {
  if (!flags.location) return null;
  if (flags.location === 'fontist' || flags.location === 'user' || flags.location === 'system') {
    return flags.location;
  }
  return null;
}


function createProgram(): Command {
  const program = new Command();

  program
    .name('fontist')
    .description('Install openly-licensed fonts via fontist formulas')
    .version(`fontist: ${FONTIST_VERSION}`)
    .option('--verbose', 'show debug output')
    .option('-q, --quiet', 'Hide all messages')
    .option('-c, --no-cache', 'Avoid using cache during download')
    .option('--preferred-family', 'Use Preferred Family when available')
    .option('-i, --interactive', 'Interactive mode', true)
    .option('--formulas-path <path>', 'Path to formulas');

program
    .command('version')
    .description('Show fontist and formulas repository version information')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        ctx.ui.say(`fontist: ${FONTIST_VERSION}`);
        const repo = new FormulasRepo(ctx);
        if (await repo.exists()) {
          try {
            const info = await repo.describe();
            ctx.ui.say('formulas:');
            ctx.ui.say(`  repo: ${info.url ?? ''}`);
            ctx.ui.say(`  version: ${FORMULAS_VERSION}`);
            ctx.ui.say(`  branch: ${info.branch ?? ''}`);
            ctx.ui.say(`  commit: ${info.revision ?? ''}`);
            ctx.ui.say(`  updated: ${info.updatedAt ? info.updatedAt.toISOString().slice(0, 10) : ''}`);
          } catch (err) {
            ctx.ui.debug(`Could not read formulas repository info: ${String(err)}`);
          }
        }
      });
    });

installSpecOptions(program.command('install'))
    .arguments('<font...>')
    .description('Install one or more fonts')
    .action(async (fonts: string[], flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const spec = formatSpecFrom(flags);
        const result = await Font.installMany(fonts, ctx, {
          force: flags.force ?? false,
          formula: flags.formula ? fonts[0] : null,
          confirmation: flags.acceptAllLicenses || flags.confirmLicense ? 'yes' : null,
          hideLicenses: flags.hideLicenses ?? false,
          noProgress: flags.noProgress ?? false,
          version: flags.version ?? null,
          smallest: flags.smallest ?? false,
          newest: flags.newest ?? false,
          sizeLimitMb: parseSizeLimit(flags.sizeLimit),
          updateFontconfig: flags.updateFontconfig ?? false,
          location: locationOption(flags),
          formatSpec: spec,
          interactive: process.stdin.isTTY === true,
        });
        for (const failure of result.failures) {
          reportError(ctx, failure.error, flags);
          if (failure.error.name === 'SizeLimitError') ctx.ui.say(sizeLimitHint());
        }
        if (result.failures.length > 0) {
          process.exitCode = exitCodeFor(result.failures[0]!.error) ?? 1;
        }
      });
    });

program
    .command('uninstall')
    .alias('remove')
    .arguments('<font...>')
    .description('Uninstall one or more fonts')
    .action(async (fonts: string[], flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        let lastError: Error | null = null;
        const removed: string[] = [];
        for (const font of fonts) {
          try {
            removed.push(...(await Font.uninstall(font, ctx)));
          } catch (err) {
            lastError = err as Error;
            reportError(ctx, lastError, flags);
          }
        }
        if (removed.length > 0) {
          ctx.ui.say('These fonts are removed:');
          ctx.ui.say(removed.join('\n'));
        }
        if (lastError) process.exitCode = exitCodeFor(lastError) ?? 1;
      });
    });

program
    .command('status')
    .arguments('[font]')
    .description('Show paths of installed fonts (all, or matching a name)')
    .action(async (font: string | undefined, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const paths = await Font.status(font ?? null, ctx);
        if (paths.length === 0) {
          ctx.ui.error('No font is installed.');
          process.exitCode = STATUS_MISSING_FONT_ERROR;
          return;
        }
        if (!font) {
          for (const fontPath of paths) ctx.ui.say(fontPath);
        }
      });
    });

program
    .command('list')
    .arguments('[font]')
    .description('List font installation status (formula -> font -> style)')
    .action(async (font: string | undefined, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const list = await Font.list(font ?? null, ctx);
        for (const [formulaKey, fonts] of Object.entries(list)) {
          ctx.ui.say(formulaKey);
          for (const [fontName, styles] of Object.entries(fonts)) {
            ctx.ui.say(`  ${fontName}`);
            for (const [style, installed] of Object.entries(styles)) {
              ctx.ui.say(`    ${style} (${installed ? 'installed' : 'not installed'})`);
            }
          }
        }
      });
    });

program
    .command('update')
    .description('Update the formulas repositories and rebuild indexes')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          await updateFormulas(ctx);
          ctx.ui.say('Formulas have been successfully updated.');
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('fontconfig')
    .description('Fontconfig integration')
    .argument('<action>', 'update | remove')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          if (action === 'update') {
            await new Fontconfig(ctx).update();
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'remove') {
            await Fontconfig.remove(ctx, { force: flags.force });
            ctx.ui.say('Fontconfig file has been successfully removed.');
            process.exitCode = STATUS_SUCCESS;
          } else {
            ctx.ui.error(`Unknown fontconfig action: ${action} (use update or remove)`);
            process.exitCode = 1;
            return;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('find')
    .description('Find fonts by capabilities')
    .option('--axes <axes>', "Variable axes to match (comma-separated, e.g., 'wght,wdth')")
    .option('--variable', 'Find all variable fonts')
    .option('--category <category>', 'Filter by category (sans-serif, serif, monospace, display)')
    .option('--format <format>', 'Filter by format (ttf, otf, woff2)')
    .option('--json', 'Output as JSON')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        await ensureFormulasAvailable(ctx);
        const repository = new FormulaRepository(ctx);
        const formulas = (await repository.all()).filter((formula) =>
          formula.compatibleWithPlatform(ctx.platform),
        );
        const finder = new FontFinder(formulas, {
          formatSpec: flags.format ? FormatSpec.fromOptions({ format: flags.format }) : null,
          category: flags.category ?? null,
        });
        let results: FontMatch[];
        if (flags.variable) {
          results = finder.variableFonts();
        } else if (flags.axes) {
          results = finder.byAxes(flags.axes.split(',').map((axis) => axis.trim()));
        } else if (flags.category) {
          results = finder.byCategory(flags.category);
        } else {
          ctx.ui.error('Please specify --axes, --variable, or --category');
          process.exitCode = 1;
          return;
        }
        if (flags.json) {
          ctx.ui.say(JSON.stringify(results.map((match) => match.toObject()), null, 2));
        } else {
          for (const match of results) {
            const data = match.toObject();
            ctx.ui.say(
              `${data.name}${data.format ? ` [${data.format}]` : ''}` +
                `${Array.isArray(data.axes) && data.axes.length > 0 ? ` (${data.axes.join(',')})` : ''}` +
                `${data.category ? ` {${data.category}}` : ''}`,
            );
          }
        }
      });
    });

program
    .command('validate')
    .description('Font validation utilities')
    .option('--format <format>', 'Output format: text, yaml, or json')
    .option('--output <file>', 'Save report to specified file')
    .option('--parallel', 'Use parallel processing')
    .option('--rebuild', 'Rebuild cache even if it exists and is not stale')
    .option('--verbose', 'Show detailed progress')
    .argument('<action>', 'report | cache')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const { Validator, ValidationCache } = await import('../validation/validator.js');
          const validator = new Validator(ctx);
          const cachePath = path.join(ctx.paths.fontistPath(), 'validation_cache.json');
          const cacheData = (await fspReadJson(cachePath).catch(() => null)) as
            | { generated_at: number; entries: [] }
            | null;
          const cache = cacheData === null ? ValidationCache.empty() : ValidationCache.fromData(cacheData);

          if (action === 'report') {
            const useCache = !flags.rebuild && !cache.stale() && cache.entries.length > 0;
            const report = await validator.validateAll({
              parallel: flags.parallel ?? false,
              cache: useCache ? cache : null,
              verbose: flags.verbose ?? false,
            });
            const format = flags.format ?? 'text';
            if (format === 'json') {
              ctx.ui.say(JSON.stringify(report.data, null, 2));
            } else if (format === 'yaml') {
              const YAML = await import('yaml');
              ctx.ui.say(YAML.stringify(report.data, { lineWidth: 100 }));
            } else {
              ctx.ui.say(`Validation report (${report.data.platform}):`);
              ctx.ui.say(`  Total fonts:   ${report.data.total_fonts}`);
              ctx.ui.say(`  Valid:         ${report.data.valid_fonts}`);
              ctx.ui.say(`  Invalid:       ${report.data.invalid_fonts}`);
              ctx.ui.say(`  Total time:    ${report.data.total_time.toFixed(2)}s`);
              for (const invalid of report.invalidResults()) {
                ctx.ui.say(`  INVALID ${invalid.path}: ${invalid.error_message ?? 'unknown error'}`);
              }
            }
            if (flags.output) {
              const { atomicWriteFile } = await import('../util/fsx.js');
              const content =
                flags.format === 'json'
                  ? JSON.stringify(report.data, null, 2)
                  : flags.format === 'yaml'
                    ? (await import('yaml')).stringify(report.data, { lineWidth: 100 })
                    : JSON.stringify(report.data, null, 2);
              await atomicWriteFile(flags.output, content);
            }
          } else if (action === 'cache') {
            await validator.validateAll({ parallel: flags.parallel ?? false, cache: null, verbose: flags.verbose ?? false });
            const { ValidationCache: VC } = await import('../validation/validator.js');
            void VC;
            ctx.ui.say('Validation cache built.');
          } else {
            ctx.ui.error(`Unknown validate action: ${action} (use report or cache)`);
            process.exitCode = 1;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

const importCmd = program
  .command('import')
  .description('Import fonts to create new formulas');

function formatImportDuration(seconds: number): string {
  if (seconds < 60) return `${(seconds / 1000).toFixed(2)}s`;
  const minutes = Math.floor(seconds / 1000 / 60);
  const remainingSeconds = ((seconds / 1000) % 60).toFixed(2);
  return `${minutes}m ${remainingSeconds}s`;
}

function reportImportResult(
  ctx: FontistContext,
  result: {
    successful: number;
    failed: number;
    skipped: number;
    overwritten: number;
    duration: number;
  },
): void {
  ctx.ui.say('Import completed');
  ctx.ui.say(`  Successful: ${result.successful}`);
  if (result.skipped > 0) ctx.ui.say(`  Skipped: ${result.skipped}`);
  if (result.overwritten > 0) ctx.ui.say(`  Overwritten: ${result.overwritten}`);
  if (result.failed > 0) ctx.ui.say(`  Failed: ${result.failed}`);
  ctx.ui.say(`  Duration: ${formatImportDuration(result.duration)}`);
}

importCmd
  .command('google')
  .description('Import Google fonts')
  .option('--source-path <path>', 'Path to checked-out google/fonts repository')
  .option('--output-path <path>', 'Output path for generated formulas (default: ./Formulas/google)')
  .option('--font-name <name>', 'Import specific font family by name', undefined)
  .option('--font-family <name>', 'Alias of --font-name')
  .option('-f, --force', 'Overwrite existing formulas')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--import-cache <dir>', 'Directory for import cache')
  .option('--schema-version <version>', 'Formula schema version (4 or 5)', '4')
  .action(async (flags: CliFlags & {
    sourcePath?: string;
    outputPath?: string;
    fontName?: string;
    fontFamily?: string;
    force?: boolean;
    verbose?: boolean;
    importCache?: string;
    schemaVersion?: string;
  }) => {
    await withContext(flags, async (ctx) => {
      try {
        const { GoogleFontsImporter } = await import('../import/google/googleFontsImporter.js');
        const importer = new GoogleFontsImporter(ctx, {
          sourcePath: flags.sourcePath,
          outputPath: flags.outputPath,
          fontFamily: flags.fontName ?? flags.fontFamily,
          force: flags.force,
          verbose: flags.verbose,
          importCache: flags.importCache,
          schemaVersion: Number.parseInt(flags.schemaVersion ?? '4', 10),
        });
        const result = await importer.import();
        if (!flags.verbose) reportImportResult(ctx, result);
        process.exitCode = STATUS_SUCCESS;
      } catch (err) {
        ctx.ui.error(`Import error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = STATUS_UNKNOWN_ERROR;
      }
    });
  });

importCmd
  .command('macos')
  .description('Import macOS supplementary fonts')
  .option('--plist <path>', 'Path to macOS font catalog XML (e.g., com_apple_MobileAsset_Font8.xml)')
  .option('--output-path <path>', 'Output directory for generated formulas (default: formulas/macos)')
  .option('--formulas-dir <dir>', 'DEPRECATED: Use --output-path instead')
  .option('--font-name <name>', 'Import specific font by name (optional)')
  .option('-f, --force', 'Overwrite existing formulas')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--import-cache <dir>', 'Directory for import cache')
  .option('--schema-version <version>', 'Formula schema version (4 or 5)', '4')
  .action(async (flags: CliFlags & {
    plist?: string;
    outputPath?: string;
    formulasDir?: string;
    fontName?: string;
    force?: boolean;
    verbose?: boolean;
    importCache?: string;
    schemaVersion?: string;
  }) => {
    await withContext(flags, async (ctx) => {
      try {
        const { MacosImporter } = await import('../import/macos/macosImporter.js');
        const { CatalogManager } = await import('../import/macos/catalog/catalogManager.js');

        let outputDir = flags.outputPath;
        if (flags.formulasDir && !flags.outputPath) {
          ctx.ui.error('DEPRECATED: --formulas-dir is deprecated, use --output-path instead');
          outputDir = flags.formulasDir;
        }

        let plistPath = flags.plist ?? null;
        if (!plistPath) {
          const catalogs = CatalogManager.availableCatalogs(
            path.join(ctx.paths.versionsPath(), 'macos_catalogs'),
          );
          if (catalogs.length === 0) {
            throw new Error('No macOS font catalogs found. Please specify --plist path/to/catalog.xml');
          }
          plistPath = catalogs[catalogs.length - 1]!;
        }

        await new MacosImporter(ctx, plistPath, {
          formulasDir: outputDir,
          fontName: flags.fontName,
          force: flags.force,
          verbose: flags.verbose,
          importCache: flags.importCache,
          schemaVersion: Number.parseInt(flags.schemaVersion ?? '4', 10),
        }).call();
        process.exitCode = STATUS_SUCCESS;
      } catch (err) {
        ctx.ui.error(`Import error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = STATUS_UNKNOWN_ERROR;
      }
    });
  });

importCmd
  .command('sil')
  .description('Import formulas from SIL International')
  .option('--output-path <path>', 'Output directory for generated formulas')
  .option('--font-name <name>', 'Import specific font by name (optional)')
  .option('-f, --force', 'Overwrite existing formulas')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--import-cache <dir>', 'Directory for import cache')
  .option('--schema-version <version>', 'Formula schema version (4 or 5)', '4')
  .action(async (flags: CliFlags & {
    outputPath?: string;
    fontName?: string;
    force?: boolean;
    verbose?: boolean;
    importCache?: string;
    schemaVersion?: string;
  }) => {
    await withContext(flags, async (ctx) => {
      try {
        const { SilImporter } = await import('../import/silImporter.js');
        const importer = new SilImporter(ctx, {
          outputPath: flags.outputPath,
          fontName: flags.fontName,
          force: flags.force,
          verbose: flags.verbose,
          importCache: flags.importCache,
          schemaVersion: Number.parseInt(flags.schemaVersion ?? '4', 10),
        });
        const result = await importer.call();
        if (!flags.verbose) reportImportResult(ctx, result);
        process.exitCode = STATUS_SUCCESS;
      } catch (err) {
        ctx.ui.error(`Import error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = STATUS_UNKNOWN_ERROR;
      }
    });
  });

program
    .command('manifest')
    .description('Install or locate fonts declared in a manifest file')
    .argument('<action>', 'install | locations')
    .argument('<file>', 'path to the manifest YAML')
    .action(async (action: string, file: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const manifest = await Manifest.fromFile(file);
          if (action === 'install') {
            const response = await manifest.install(ctx, {
              confirmation: flags.acceptAllLicenses || flags.confirmLicense ? 'yes' : null,
              hideLicenses: flags.hideLicenses ?? false,
              noProgress: flags.noProgress ?? false,
              location: locationOption(flags),
              interactive: process.stdin.isTTY === true,
            });
            ctx.ui.say(JSON.stringify(response, null, 2));
          } else if (action === 'locations') {
            const response = await manifest.locate(ctx, { locations: true });
            ctx.ui.say(JSON.stringify(response, null, 2));
          } else {
            ctx.ui.error(`Unknown manifest action: ${action} (use install or locations)`);
            process.exitCode = 1;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('config')
    .description('Manage fontist configuration')
    .argument('<action>', 'get | set | delete | list | show | keys')
    .argument('[key]')
    .argument('[value]')
    .action(async (action: string, key: string | undefined, value: string | undefined, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          switch (action) {
            case 'list': {
              for (const [k, v] of Object.entries(ctx.config.customValues())) {
                ctx.ui.say(`${k}: ${String(v)}`);
              }
              break;
            }
            case 'get': {
              if (!key || !isConfigKey(key)) throw new InvalidConfigAttributeError(key ?? '');
              ctx.ui.say(String(ctx.config.get(key)));
              break;
            }
            case 'set': {
              if (!key || !isConfigKey(key)) throw new InvalidConfigAttributeError(key ?? '');
              const parsed: string | number | boolean =
                value === 'true' ? true : value === 'false' ? false : /^\d+$/.test(value ?? '') ? Number.parseInt(value!, 10) : value ?? '';
              ctx.config.set(key, parsed as never);
              await ctx.config.save(ctx.paths.configYmlPath());
              break;
            }
            case 'delete': {
              if (!key || !isConfigKey(key)) throw new InvalidConfigAttributeError(key ?? '');
              ctx.config.delete(key);
              await ctx.config.save(ctx.paths.configYmlPath());
              break;
            }
            case 'show': {
              const values = ctx.config.customValues();
              const entries = Object.entries(values);
              if (entries.length === 0) {
                ctx.ui.say('Config is empty.');
              } else {
                ctx.ui.say('Current config:');
                const YAML2 = await import('yaml');
                const formatted = YAML2.stringify(Object.fromEntries(entries), { lineWidth: 100 })
                  .replace(/^---.*$/m, '')
                  .trim();
                ctx.ui.say(formatted);
              }
              process.exitCode = STATUS_SUCCESS;
              break;
            }
            case 'keys': {
              ctx.ui.say('Available keys:');
              for (const [cfgKey, cfgValue] of Object.entries(ctx.config.defaultValues())) {
                ctx.ui.say(`${cfgKey} (default: ${String(cfgValue)})`);
              }
              process.exitCode = STATUS_SUCCESS;
              break;
            }
            default:
              ctx.ui.error(`Unknown config action: ${action} (use get, set, delete, list, show, or keys)`);
              process.exitCode = 1;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('cache')
    .description('Manage fontist cache')
    .argument('<action>', 'path | clear | clear-import | info')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          if (action === 'path') {
            ctx.ui.say(ctx.paths.downloadsPath());
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'clear') {
            const downloadsPath = ctx.paths.downloadsPath();
            if (existsSync(downloadsPath)) {
              await fsp.rm(downloadsPath, { recursive: true, force: true });
            }
            // Ruby clear_indexes: drop system index files (and stale locks)
            for (const indexFile of [ctx.paths.systemIndexPath()]) {
              await fsp.rm(indexFile, { force: true });
              await fsp.rm(`${indexFile}.lock`, { force: true });
            }
            ctx.ui.say('Cache has been successfully removed.');
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'clear-import') {
            const importPath = ctx.paths.importCachePath(ctx.env);
            if (existsSync(importPath)) {
              const size = await directorySize(importPath);
              await fsp.rm(importPath, { recursive: true, force: true });
              ctx.ui.say(`Import cache cleared: ${formatBytes(size)}`);
            } else {
              ctx.ui.say('Import cache is already empty');
            }
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'info') {
            const downloadsPath = ctx.paths.downloadsPath();
            const importPath = ctx.paths.importCachePath(ctx.env);
            const downloadInfo = await cacheInfo(downloadsPath);
            const importInfo = await cacheInfo(importPath);
            ctx.ui.say('Font download cache:');
            ctx.ui.say(`  Location: ${downloadsPath}`);
            ctx.ui.say(`  Size: ${formatBytes(downloadInfo.size)}`);
            ctx.ui.say(`  Files: ${downloadInfo.files}`);
            ctx.ui.say('');
            ctx.ui.say('Import cache:');
            ctx.ui.say(`  Location: ${importPath}`);
            ctx.ui.say(`  Size: ${formatBytes(importInfo.size)}`);
            ctx.ui.say(`  Files: ${importInfo.files}`);
            process.exitCode = STATUS_SUCCESS;
          } else {
            ctx.ui.error(`Unknown cache action: ${action} (use path, clear, clear-import, or info)`);
            process.exitCode = STATUS_UNKNOWN_ERROR;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });
program
    .command('index')
    .description('Manage system font index')
    .argument('<action>', 'rebuild | path | list | clear | update')
    .option('-v, --verbose', 'Show detailed progress and statistics')
    .option('-o, --output <path>', 'Save index to specified path (for inspection)')
    .option('--format <format>', 'Output format: yaml or json', 'yaml')
    .option('--limit <n>', 'Limit number of fonts to display')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const { SystemIndex } = await import('../index/installed/collectionIndexes.js');
          const { scanFontPaths } = await import('../system/pathScanning.js');
          const { systemFontPaths } = await import('../system/systemFontsData.js');
          const { defaultUserFontPath } = await import('../system/fontDirs.js');
          const YAML = await import('yaml');
          const index = new SystemIndex(ctx);
          const indexFile = ctx.paths.systemIndexPath();

          if (action === 'rebuild') {
            const startTime = Date.now();
            const dirs = [
              ...(await systemFontPaths(ctx)),
              defaultUserFontPath(ctx.platform, ctx.env),
              ctx.paths.fontsPath(),
            ];
            const allFonts = await scanFontPaths(dirs);
            const byDir = new Map<string, number>();
            for (const fontPath of allFonts) {
              const dir = path.dirname(fontPath);
              byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
            }
            ctx.ui.say('Rebuilding system font index from scratch...');
            ctx.ui.say('-'.repeat(80));
            ctx.ui.say(`Platform: ${ctx.platform}`);
            ctx.ui.say('');
            ctx.ui.say('Scanning directories:');
            for (const dir of [...byDir.keys()].sort()) {
              const count = byDir.get(dir)!;
              const managed = dir.startsWith(ctx.paths.fontsPath()) ? ' (fontist managed)' : '';
              ctx.ui.say(`  \u2713 ${dir} (${count} ${count === 1 ? 'font' : 'fonts'})${managed}`);
            }
            ctx.ui.say('');
            ctx.ui.say(`Total font files found: ${allFonts.length}`);
            ctx.ui.say('(Note: Font collections like .ttc files contain multiple fonts)');
            ctx.ui.say('-'.repeat(80));
            ctx.ui.say('');

            const indexingStart = Date.now();
            await index.rebuild({ forced: true });
            const indexingTime = (Date.now() - indexingStart) / 1000;

            if (flags.output) {
              const content = await fsp.readFile(indexFile, 'utf8');
              await fsp.mkdir(path.dirname(flags.output), { recursive: true });
              await fsp.writeFile(flags.output, content);
              ctx.ui.say(`Index saved to: ${flags.output}`);
            }

            const totalIndexed = (await index.entries()).length;
            const collectionFonts = totalIndexed - allFonts.length;
            ctx.ui.say('');
            ctx.ui.say(`  Index file: ${indexFile}`);
            ctx.ui.say('System font index rebuilt successfully');
            ctx.ui.say(`  Font files processed: ${allFonts.length}`);
            ctx.ui.say(`  Total fonts indexed:  ${totalIndexed}`);
            if (collectionFonts > 0) {
              ctx.ui.say(`  Fonts from collections: ${collectionFonts} (.ttc/.otc files)`);
            }
            ctx.ui.say('-'.repeat(80));
            ctx.ui.say('Timing:');
            ctx.ui.say(`  Directory scanning: ${((startTime === 0 ? 0 : (indexingStart - startTime) / 1000)).toFixed(2)}s`);
            ctx.ui.say(`  Font indexing:       ${indexingTime.toFixed(2)}s`);
            ctx.ui.say(`  Total time:          ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'path') {
            ctx.ui.say(indexFile);
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'list') {
            const entries = await index.entries();
            const fontsData = entries.map((fontEntry) => ({
              path: fontEntry.path,
              family_name: fontEntry.familyName,
              full_name: fontEntry.fullName,
              subfamily: fontEntry.subfamily,
              preferred_family_name: fontEntry.preferredFamilyName,
              preferred_subfamily_name: fontEntry.preferredSubfamilyName,
            }));
            const limited = flags.limit
              ? fontsData.slice(0, Number.parseInt(flags.limit, 10))
              : fontsData;
            if (flags.format === 'json') {
              ctx.ui.say(JSON.stringify(limited, null, 2));
            } else if (flags.format === 'yaml') {
              ctx.ui.say(YAML.stringify(limited, { lineWidth: 100 }));
            } else {
              ctx.ui.error(`Unknown format: ${flags.format}. Use 'yaml' or 'json'.`);
              process.exitCode = STATUS_UNKNOWN_ERROR;
              return;
            }
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'clear') {
            try {
              await fsp.access(indexFile);
              await fsp.rm(indexFile);
              ctx.ui.say(`System font index cleared: ${indexFile}`);
            } catch {
              ctx.ui.say('System font index does not exist');
            }
            process.exitCode = STATUS_SUCCESS;
          } else if (action === 'update') {
            const startTime = Date.now();
            if (!(await index.existsOnDisk())) {
              ctx.ui.say('System font index does not exist');
              ctx.ui.say("Run 'fontist index rebuild' to create it");
              process.exitCode = STATUS_UNKNOWN_ERROR;
              return;
            }
            ctx.ui.say('Updating system font index incrementally...');
            ctx.ui.say('-'.repeat(80));
            const before = (await index.entries()).length;
            const changed = await index.indexChangedNow();
            if (changed) {
              await index.rebuild({ forced: true });
              ctx.ui.say('System font index updated');
            } else {
              ctx.ui.say('No changes detected');
            }
            const after = (await index.entries()).length;
            ctx.ui.say('-'.repeat(80));
            ctx.ui.say('Fonts:');
            ctx.ui.say(`  Before: ${before}`);
            ctx.ui.say(`  After:  ${after}`);
            ctx.ui.say(`  Total time:   ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
            process.exitCode = STATUS_SUCCESS;
          } else {
            ctx.ui.error(`Unknown index action: ${action} (use rebuild, path, list, clear, or update)`);
            process.exitCode = STATUS_UNKNOWN_ERROR;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });
program
    .command('rebuild-index')
    .description('Rebuild formula index (used by formulas maintainers)')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const repository = new FormulaRepository(ctx);
          const indexes = new FormulaIndexRegistry(ctx, repository);
          await indexes.rebuildAll();
          ctx.ui.say('Formula index has been rebuilt.');
          process.exitCode = STATUS_SUCCESS;
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('migrate-formulas')
    .description('Migrate v4 formulas to v5 schema')
    .option('--dry-run', 'Show what would be done without making changes')
    .argument('<input>', 'Path to a formula file or directory of formulas')
    .argument('[output]', 'Output path (default: migrate in place)')
    .action(async (input: string, output: string | undefined, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const { V4ToV5Migrator } = await import('../import/v4ToV5Migrator.js');
          const migrator = new V4ToV5Migrator(input, output ?? null, {
            verbose: flags.verbose,
            dryRun: flags.dryRun,
          });
          const results = migrator.migrateAll();
          if (results.failed > 0) {
            ctx.ui.error(`Migration completed with ${results.failed} error(s)`);
            process.exitCode = STATUS_UNKNOWN_ERROR;
          } else {
            ctx.ui.say(
              `Migrated ${results.migrated} formula(s), skipped ${results.skipped} already v5 formula(s)`,
            );
            process.exitCode = STATUS_SUCCESS;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('create-formula')
    .description('Create a new formula with fonts from URL')
    .option('--name <name>', 'Formula name, e.g. "Times New Roman"')
    .option('--mirror <url>', 'Mirror URL (repeatable)', (value: string, previous: string[] | undefined) =>
      [...(previous ?? []), value],
    )
    .option('--subdir <dir>', 'Subdirectory to take fonts from (fnmatch patterns allowed)')
    .option('--file-pattern <pattern>', "File pattern, e.g. '*.otf'")
    .option('--name-prefix <prefix>', "Prefix to add to all font family names, e.g. 'Wine '")
    .option('--schema-version <version>', 'Formula schema version (default: 5)', '5')
    .argument('<url>', 'Archive URL or local path')
    .action(async (url: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const { CreateFormula } = await import('../import/createFormula.js');
          const formulaFile = await new CreateFormula(ctx, url, {
            name: flags.name,
            mirror: flags.mirror,
            subdir: flags.subdir,
            filePattern: flags.filePattern,
            namePrefix: flags.namePrefix,
            schemaVersion: Number.parseInt(flags.schemaVersion ?? '5', 10),
          }).call();
          ctx.ui.say(`${formulaFile} formula has been successfully created`);
          process.exitCode = STATUS_SUCCESS;
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('macos-catalogs')
    .description('List available macOS font catalogs')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const { CatalogManager } = await import('../import/macos/catalog/catalogManager.js');
          const catalogs = CatalogManager.availableCatalogs(
            path.join(ctx.paths.versionsPath(), 'macos_catalogs'),
          );

          if (catalogs.length === 0) {
            ctx.ui.error('No macOS font catalogs found.');
            ctx.ui.say('Expected location: /System/Library/AssetsV2/');
            ctx.ui.say('');
            ctx.ui.say('You can specify a catalog manually with:');
            ctx.ui.say('  fontist import macos --plist path/to/com_apple_MobileAsset_FontX.xml');
            process.exitCode = STATUS_UNKNOWN_ERROR;
            return;
          }

          ctx.ui.say('Available macOS Font Catalogs:');
          for (const catalogPath of catalogs) {
            const versionNum = CatalogManager.detectVersion(catalogPath);
            const size = (await fsp.stat(catalogPath)).size;
            ctx.ui.say(`  Font${versionNum}: ${catalogPath} (${formatBytes(size)})`);
          }

          ctx.ui.say('');
          ctx.ui.say('To import a catalog:');
          ctx.ui.say('  fontist import macos --plist <path>');
          process.exitCode = STATUS_SUCCESS;
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('repo')
    .description('Manage private formulas repositories')
    .argument('<action>', 'setup | update | remove | list | info')
    .argument('[name]')
    .argument('[url]')
    .action(async (action: string, name: string | undefined, url: string | undefined, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const repos = new PrivateRepos(ctx);
        try {
          switch (action) {
            case 'setup':
              if (!name || !url) throw new InvalidConfigAttributeError('repo setup requires NAME and URL');
              await repos.setup(name, url, { overwrite: flags.force });
              ctx.ui.say(`Repository "${name}" set up.`);
              break;
            case 'update':
              if (!name) throw new InvalidConfigAttributeError('repo update requires NAME');
              await repos.update(name);
              ctx.ui.say(`Repository "${name}" updated.`);
              break;
            case 'remove':
              if (!name) throw new InvalidConfigAttributeError('repo remove requires NAME');
              await repos.remove(name);
              ctx.ui.say(`Repository "${name}" removed.`);
              break;
            case 'list': {
              const names = await repos.list();
              for (const repoName of names) ctx.ui.say(repoName);
              break;
            }
            case 'info': {
              if (!name) throw new InvalidConfigAttributeError('repo info requires NAME');
              const info = await repos.info(name);
              ctx.ui.say(`name: ${info.name}`);
              ctx.ui.say(`url: ${info.url ?? ''}`);
              ctx.ui.say(`revision: ${info.revision ?? ''}`);
              ctx.ui.say(`formulas: ${info.formulaCount}`);
              break;
            }
            default:
              ctx.ui.error(`Unknown repo action: ${action}`);
              process.exitCode = 1;
          }
        } catch (err) {
          reportError(ctx, err as Error, flags);
          process.exitCode = exitCodeFor(err as Error) ?? 1;
        }
      });
    });

program
    .command('info')
    .description('Show formulas repository information')
    .action(async (flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const repo = new FormulasRepo(ctx);
        if (!(await repo.exists())) {
          ctx.ui.say('formulas repository: not cloned yet (run `fontist update`)');
          return;
        }
        const info = await repo.describe();
        ctx.ui.say('formulas:');
        ctx.ui.say(`  repo: ${info.url ?? ''}`);
        ctx.ui.say(`  branch: ${info.branch ?? ''}`);
        ctx.ui.say(`  commit: ${info.revision ?? ''}`);
        ctx.ui.say(`  updated: ${info.updatedAt ? info.updatedAt.toISOString().slice(0, 10) : ''}`);
      });
    });


  return program;
}

function reportError(ctx: FontistContext, error: Error, flags: CliFlags): void {
  ctx.ui.error(`${error.name}: ${error.message}`);
  if (error.name === 'SizeLimitError') {
    ctx.ui.say(sizeLimitHint());
  }
  if (flags.verbose) {
    ctx.ui.debug(error.stack ?? '');
  }
}

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  ui: UI | null = null,
): Promise<number> {
  cliEnv = env;
  cliUi = ui;
  const program = createProgram();
  program.exitOverride();
  process.exitCode = 0;
  globalFlags = {};
  // Actions run during parse; capture program-level options before each.
  program.hook('preAction', (thisCommand, actionCommand) => {
    globalFlags = {
      ...(thisCommand.opts() as CliFlags),
      ...(actionCommand.optsWithGlobals() as CliFlags),
    };
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    const code = exitCodeFor(err as Error);
    if ((err as { code?: string }).code === 'commander.help') return 0;
    if (code !== null) return code;
    throw err;
  }
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMain) {
  // Piping into `head`/`grep -m1` closes stdout early; exit quietly instead
  // of crashing with an unhandled EPIPE.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') process.exit(0);
      throw err;
    });
  }
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
