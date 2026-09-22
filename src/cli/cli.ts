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
import { Fontconfig } from '../fontconfig/fontconfig.js';
import { FormulaIndexRegistry } from '../index/formula/formulaFontIndex.js';
import { FormulasRepo } from '../repo/formulasRepo.js';
import { PrivateRepos } from '../repo/privateRepos.js';
import { updateFormulas } from '../repo/update.js';
import { UI } from '../ui/ui.js';
import { exitCodeFor, sizeLimitHint } from './exitCodes.js';

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
  format?: string;
  variableAxes?: string;
  preferVariable?: boolean;
  collectionIndex?: string;
  interactive?: boolean;
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
    .arguments('<font...>')
    .description('Uninstall one or more fonts')
    .action(async (fonts: string[], flags: CliFlags) => {
      await withContext(flags, async (ctx) => {
        let lastError: Error | null = null;
        for (const font of fonts) {
          try {
            await Font.uninstall(font, ctx);
          } catch (err) {
            lastError = err as Error;
            reportError(ctx, lastError, flags);
          }
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
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
