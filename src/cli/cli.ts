#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { createContext, FONTIST_VERSION, type FontistContext } from '../context.js';
import { FORMULAS_VERSION } from '../paths.js';
import { Font } from '../api/font.js';
import { Manifest } from '../api/manifest.js';
import { isConfigKey } from '../config/config.js';
import { DownloadCache } from '../download/downloadCache.js';
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
  collectionIndex?: string;
  interactive?: boolean;
  axes?: string;
  variable?: boolean;
  category?: string;
  json?: boolean;
  format?: string;
  output?: string;
  parallel?: boolean;
  rebuild?: boolean;
}


let cliEnv: NodeJS.ProcessEnv = process.env;
let cliUi: UI | null = null;

function contextOptions(flags: CliFlags): { ui: UI } {
  if (cliUi) return { ui: cliUi };
  return { ui: new UI({ level: flags.verbose ? 'debug' : 'info' }) };
}

async function withContext<T>(
  flags: CliFlags,
  fn: (ctx: FontistContext) => Promise<T>,
): Promise<T> {
  const ctx = await createContext(cliEnv, contextOptions(flags));
  return fn(ctx);
}

function installSpecOptions(command: Command): Command {
  return command
    .option('-f, --force', 'Install even if already installed in system')
    .option('-F, --formula', 'Install whole formula instead of a font')
    .option('-a, --accept-all-licenses', 'Accept all license agreements')
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
    .option('--collection-index <index>', 'Index of the face inside a collection (ttc/otc)');
}

function formatSpecFrom(flags: CliFlags): FormatSpec | null {
  const spec = FormatSpec.fromOptions({
    format: flags.format,
    variableAxes: parseVariableAxes(flags.variableAxes),
    preferVariable: flags.preferVariable ?? false,
    collectionIndex: flags.collectionIndex ? Number.parseInt(flags.collectionIndex, 10) : null,
  });
  return spec.hasConstraints() ? spec : null;
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
    .option('--verbose', 'show debug output');

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
          confirmation: flags.acceptAllLicenses ? 'yes' : null,
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
    .argument('<action>', 'update')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          if (action !== 'update') {
            ctx.ui.error(`Unknown fontconfig action: ${action} (use update)`);
            process.exitCode = 1;
            return;
          }
          await new Fontconfig(ctx).update();
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
              confirmation: flags.acceptAllLicenses ? 'yes' : null,
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
    .argument('<action>', 'get | set | delete | list')
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
            default:
              ctx.ui.error(`Unknown config action: ${action} (use get, set, delete or list)`);
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
    .description('Manage the download cache')
    .argument('<action>', 'clear | path')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        const cache = new DownloadCache(ctx);
        if (action === 'clear') {
          await cache.clear();
          ctx.ui.say(`Download cache cleared: ${cache.mapPath()}`);
        } else if (action === 'path') {
          ctx.ui.say(cache.directory());
        } else {
          ctx.ui.error(`Unknown cache action: ${action} (use clear or path)`);
          process.exitCode = 1;
        }
      });
    });

program
    .command('index')
    .description('Manage formula indexes')
    .argument('<action>', 'rebuild | build')
    .action(async (action: string, flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        try {
          const repository = new FormulaRepository(ctx);
          const indexes = new FormulaIndexRegistry(ctx, repository);
          if (action === 'rebuild') {
            await indexes.rebuildAll();
            ctx.ui.say('Formula indexes rebuilt.');
          } else if (action === 'build') {
            await indexes.rebuildAll();
            ctx.ui.say('Formula indexes built.');
          } else {
            ctx.ui.error(`Unknown index action: ${action} (use rebuild or build)`);
            process.exitCode = 1;
          }
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
