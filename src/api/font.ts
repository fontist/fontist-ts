import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import {
  LicensingError,
  ManualFontError,
  MissingFontError,
  UnsupportedFontError,
} from '../errors/errors.js';
import { DownloadCache } from '../download/downloadCache.js';
import type { FormatSpec } from '../formula/formatSpec.js';
import type { Formula } from '../formula/formula.js';
import { FormulaPicker } from '../formula/formulaPicker.js';
import { FormulaRepository } from '../formula/formulaRepository.js';
import { FormulaIndexRegistry } from '../index/formula/formulaFontIndex.js';
import { FontistIndex, SystemIndex, UserIndex } from '../index/installed/collectionIndexes.js';
import {
  createInstallLocation,
  type BaseLocation,
  type InstallLocationType,
} from '../locations/installLocation.js';
import { FontInstaller } from '../installer/fontInstaller.js';
import { Fontconfig } from '../fontconfig/fontconfig.js';
import { SystemFont } from '../system/systemFont.js';
import { FontPath } from '../fonts/fontPath.js';
import type { FontModel } from '../formula/models.js';
import { defaultUserFontPath } from '../system/fontDirs.js';
import { FormulaSuggestion } from '../formula/formulaSuggestion.js';
import { ensureFormulasAvailable } from '../repo/formulasRepo.js';
import { mkdirp } from '../util/fsx.js';

export interface FontOptions {
  name?: string | null;
  confirmation?: string | null;
  hideLicenses?: boolean;
  noProgress?: boolean;
  force?: boolean;
  version?: string | null;
  smallest?: boolean;
  newest?: boolean;
  sizeLimitMb?: number | null;
  formula?: string | null;
  updateFontconfig?: boolean;
  location?: InstallLocationType | null;
  formatSpec?: FormatSpec | null;
  interactive?: boolean;
}

/** The high-level font facade: find / install / uninstall / status / list. */
export class Font {
  private readonly ctx: FontistContext;
  private readonly options: FontOptions;
  private readonly repository: FormulaRepository;
  private readonly systemFont: SystemFont;
  private confirmation: string | null;

  private constructor(ctx: FontistContext, options: FontOptions) {
    this.ctx = ctx;
    this.options = options;
    this.repository = new FormulaRepository(ctx);
    this.systemFont = new SystemFont(ctx);
    this.confirmation = options.confirmation ?? null;
  }

  static async find(name: string, ctx: FontistContext): Promise<string[]> {
    await ensureFormulasAvailable(ctx);
    return new Font(ctx, { name }).doFind();
  }

  static async install(
    name: string,
    ctx: FontistContext,
    options: FontOptions = {},
  ): Promise<string[]> {
    await ensureFormulasAvailable(ctx);
    return new Font(ctx, { ...options, name }).doInstall();
  }

  static async installMany(
    names: string[],
    ctx: FontistContext,
    options: FontOptions = {},
  ): Promise<{ successes: string[]; failures: { font: string; error: Error }[] }> {
    const successes: string[] = [];
    const failures: { font: string; error: Error }[] = [];
    for (const name of names) {
      try {
        await Font.install(name, ctx, options);
        successes.push(name);
      } catch (err) {
        failures.push({ font: name, error: err as Error });
      }
    }
    return { successes, failures };
  }

  static async uninstall(name: string, ctx: FontistContext): Promise<string[]> {
    await ensureFormulasAvailable(ctx);
    return new Font(ctx, { name }).doUninstall();
  }

  static async status(name: string | null, ctx: FontistContext): Promise<string[]> {
    await ensureFormulasAvailable(ctx);
    return new Font(ctx, { name }).doStatus();
  }

  static async list(
    name: string | null,
    ctx: FontistContext,
  ): Promise<Record<string, Record<string, Record<string, boolean>>>> {
    await ensureFormulasAvailable(ctx);
    return new Font(ctx, { name }).doList();
  }

  /** All fonts declared by platform-supported formulas
   * (Ruby `all_formulas.map(&:fonts).flatten`). */
  static async all(ctx: FontistContext): Promise<FontModel[]> {
    await ensureFormulasAvailable(ctx);
    const repository = new FormulaRepository(ctx);
    const formulas = await repository.all();
    return formulas
      .filter((formula) => this.isSupportedFormula(formula, ctx))
      .flatMap((formula) => formula.allFonts());
  }

  private static isSupportedFormula(formula: Formula, ctx: FontistContext): boolean {
    return formula.compatibleWithPlatform(ctx.platform);
  }

  // ── find ────────────────────────────────────────────────────────────────

  private async doFind(): Promise<string[]> {
    const name = this.requiredName();
    const systemPaths = await this.findSystemFont(name);
    if (systemPaths) return systemPaths;
    const formulas = await this.formulasFor(name);
    if (formulas.some((f) => f.isDownloadable())) {
      throw new MissingFontError(name);
    }
    if (formulas.length > 0) {
      throw new ManualFontError(name, formulas[0]!.instructions);
    }
    throw new UnsupportedFontError(name);
  }

  // ── install ─────────────────────────────────────────────────────────────

  private async doInstall(): Promise<string[]> {
    if (this.options.formula) {
      return this.installFormula(this.options.formula);
    }
    const name = this.requiredName();
    await mkdirp(this.ctx.paths.fontsPath());

    if (!this.options.force) {
      const systemPaths = await this.findSystemFont(name);
      if (systemPaths) return systemPaths;
    }

    const formulas = await this.formulasFor(name);
    const downloadable = formulas.filter((f) => f.isDownloadable());
    const manual = formulas.filter((f) => !f.isDownloadable());
    if (downloadable.length === 0) {
      if (manual.length > 0) throw new ManualFontError(name, manual[0]!.instructions);
      throw new UnsupportedFontError(name);
    }

    const cache = new DownloadCache(this.ctx);
    const picker = new FormulaPicker(name, {
      sizeLimitMb: this.options.sizeLimitMb ?? null,
      version: this.options.version ?? null,
      smallest: this.options.smallest ?? false,
      newest: this.options.newest ?? false,
      formatSpec: this.options.formatSpec ?? null,
      resourcesCached: (formula) => cache.allFetched(formula.resources.flatMap((r) => r.urls)),
    });
    const chosen = await picker.call(downloadable);
    if (chosen.length === 0) {
      throw new MissingFontError(name);
    }

    const installed: string[] = [];
    for (const formula of chosen) {
      installed.push(...(await this.requestFormulaInstallation(formula, name)));
    }
    await this.updateFontconfig();
    return installed;
  }

  private async installFormula(formulaName: string): Promise<string[]> {
    const formula = await this.repository.findByKeyOrName(formulaName);
    if (!formula || !formula.isDownloadable()) {
      await this.suggestFormula(formulaName);
      throw new MissingFontError(formulaName);
    }
    return this.requestFormulaInstallation(formula, null);
  }

  private async suggestFormula(name: string): Promise<void> {
    if (!this.options.interactive) return;
    const suggestions = await new FormulaSuggestion(this.repository).find(name);
    if (suggestions.length > 0) {
      this.ctx.ui.say(`Formula "${name}" not found. Did you mean?`);
      suggestions.forEach((key, index) => this.ctx.ui.say(`[${index}] ${key}`));
    }
  }

  private async requestFormulaInstallation(formula: Formula, fontName: string | null): Promise<string[]> {
    const confirmation = await this.confirmLicense(formula, fontName);
    const installer = new FontInstaller(this.ctx, formula, {
      fontName,
      noProgress: this.options.noProgress ?? false,
      location: this.options.location ?? null,
      formatSpec: this.options.formatSpec ?? null,
      confirmation,
    });
    await this.warnPermissions(installer.getLocation());
    const paths = await installer.install(this.confirmation);
    if (paths === null || paths.length === 0) {
      this.ctx.ui.error(`Fonts not found in formula ${formula.key()}`);
      return [];
    }
    this.ctx.ui.say('Fonts installed at:');
    for (const fontPath of paths) {
      this.ctx.ui.say(`- ${fontPath}`);
    }
    return paths;
  }

  private async confirmLicense(formula: Formula, fontName: string | null): Promise<string | null> {
    if (!formula.licenseRequired()) return this.confirmation;
    if (formula.licensedForCurrentPlatform(this.ctx.platform)) return this.confirmation;
    const license = formula.license() ?? '';
    if (!this.options.hideLicenses) {
      const humanName = fontName !== null ? formula.fontByName(fontName)?.name ?? formula.name : formula.name;
      this.ctx.ui.say(
        `FONT LICENSE ACCEPTANCE REQUIRED FOR "${humanName}":\n\n` +
          'Fontist can install this font if you accept its licensing conditions.\n\n' +
          `FONT LICENSE BEGIN ("${humanName}")\n` +
          '-----------------------------------------------------------------------\n' +
          `${license}\n` +
          '-----------------------------------------------------------------------\n' +
          `FONT LICENSE END ("${humanName}")`,
      );
    }
    if (this.confirmation?.toLowerCase() === 'yes') return this.confirmation;
    if (this.confirmation?.toLowerCase() === 'no') {
      throw new LicensingError();
    }
    if (this.options.interactive === false) {
      throw new LicensingError();
    }
    const answer = await this.ctx.ui.ask(
      "\nDo you accept all presented font licenses, and want Fontist " +
        "to download these fonts for you? => TYPE 'yes' to continue, or press ENTER to cancel:",
    );
    if (answer.trim().toLowerCase() === 'yes') {
      this.confirmation = 'yes';
      return this.confirmation;
    }
    throw new LicensingError();
  }

  private async warnPermissions(location: BaseLocation): Promise<void> {
    const warning = location.permissionWarning();
    if (!warning) return;
    this.ctx.ui.say(warning);
    if (this.options.interactive === false) return;
    this.ctx.ui.say('Proceeding in 3 seconds... (Press Ctrl+C to cancel)');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  private async updateFontconfig(): Promise<void> {
    if (!this.options.updateFontconfig) return;
    await new Fontconfig(this.ctx).update();
  }

  // ── uninstall ───────────────────────────────────────────────────────────

  private async doUninstall(): Promise<string[]> {
    const name = this.requiredName();
    const scopes: { index: FontistIndex | UserIndex | SystemIndex; locationFor: (fontPath: string) => Promise<BaseLocation | null> }[] = [
      { index: new FontistIndex(this.ctx), locationFor: (p) => this.locationFromPath(p) },
      {
        index: new UserIndex(this.ctx, defaultUserFontPath(this.ctx.platform, this.ctx.env)),
        locationFor: async () => createInstallLocation('user', this.ctx),
      },
      { index: new SystemIndex(this.ctx), locationFor: async () => createInstallLocation('system', this.ctx) },
    ];

    const uninstalled: string[] = [];
    for (const scope of scopes) {
      const fonts = (await scope.index.find(name, null)) ?? [];
      for (const font of fonts) {
        const location = await scope.locationFor(font.path);
        if (!location) continue;
        const removed = await location.uninstallFont(path.basename(font.path));
        if (removed) uninstalled.push(removed);
      }
    }
    if (uninstalled.length === 0) {
      const formulas = await this.formulasFor(name);
      if (formulas.some((f) => f.isDownloadable())) throw new MissingFontError(name);
      throw new UnsupportedFontError(name);
    }
    return uninstalled;
  }

  private async locationFromPath(fontPath: string): Promise<BaseLocation | null> {
    const fontsPath = this.ctx.paths.fontsPath();
    const normalized = fontPath.replace(/\\/g, '/');
    const normalizedRoot = `${fontsPath.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
    if (normalized.startsWith(normalizedRoot)) {
      const relative = normalized.slice(normalizedRoot.length);
      const formulaKey = relative.split('/')[0] ?? '';
      const formula = await this.repository.findByKey(formulaKey);
      if (formula) return createInstallLocation('fontist', this.ctx, formula);
      return createInstallLocation('fontist', this.ctx);
    }
    return null;
  }

  // ── status / list ───────────────────────────────────────────────────────

  private async doStatus(): Promise<string[]> {
    const name = this.options.name;
    if (!name) {
      return this.systemFont.fontPaths();
    }
    return (await this.doFind()) ?? [];
  }

  private async doList(): Promise<Record<string, Record<string, Record<string, boolean>>>> {
    const requested = this.options.name ?? null;
    const formulas = await this.formulasFor(requested ?? '', true);
    const result: Record<string, Record<string, Record<string, boolean>>> = {};
    for (const formula of formulas) {
      const formulaResult: Record<string, Record<string, boolean>> = {};
      for (const font of formula.allFonts()) {
        if (requested !== null && (font.name === null || font.name.toLowerCase() !== requested.toLowerCase())) {
          continue;
        }
        const fontResult: Record<string, boolean> = {};
        for (const style of font.styles) {
          fontResult[style.type ?? ''] = await this.isStyleInstalled(style);
        }
        formulaResult[font.name ?? ''] = fontResult;
      }
      result[formula.key()] = formulaResult;
    }
    return result;
  }

  private async isStyleInstalled(style: { font: string | null }): Promise<boolean> {
    if (style.font === null) return false;
    return (await scanForFile(this.ctx.paths.fontsPath(), style.font)) !== null;
  }

  // ── shared helpers ──────────────────────────────────────────────────────

  private requiredName(): string {
    const name = this.options.name;
    if (!name) throw new UnsupportedFontError('(no font name given)');
    return name;
  }

  private async findSystemFont(name: string): Promise<string[] | null> {
    const paths = await this.systemFont.find(name);
    if (!paths) {
      this.ctx.ui.say(`Font "${name}" not found locally.`);
      return null;
    }
    this.ctx.ui.say('Fonts found at:');
    for (const fontPath of paths) {
      this.ctx.ui.say(await new FontPath(fontPath, this.ctx).toString());
    }
    return paths;
  }

  private async formulasFor(name: string, all = false): Promise<Formula[]> {
    if (all) {
      const formulas = await this.repository.all();
      return formulas.filter((formula) => Font.isSupportedFormula(formula, this.ctx));
    }
    const indexRegistry = new FormulaIndexRegistry(this.ctx, this.repository);
    const matched = await indexRegistry.fontIndex().loadFormulas(name);
    return matched.filter((formula) => Font.isSupportedFormula(formula, this.ctx));
  }

  /** Exposed for the manifest layer to reuse the install flow. */
  static installOptionsFor(formatSpec: FormatSpec | null): FontOptions {
    return { formatSpec, force: true };
  }
}

async function scanForFile(root: string, fileName: string): Promise<string | null> {
  const { promises: fsp } = await import('node:fs');
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === fileName) return full;
    }
  }
  return null;
}
