import { createHash } from 'node:crypto';
import { promises as fsp, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { InvalidResourceError } from '../errors/errors.js';
import { Downloader } from '../download/downloader.js';
import { DownloadCache } from '../download/downloadCache.js';
import { type ImportSource } from '../formula/importSources.js';
import { FormulaBuilder } from './formulaBuilder.js';
import { RecursiveExtraction } from './recursiveExtraction.js';

export interface CreateFormulaOptions {
  subdir?: string;
  filePattern?: string;
  namePrefix?: string;
  verbose?: boolean;
  mirror?: string[];
  skipSha?: boolean;
  schemaVersion?: number;
  importCache?: string;
  importSource?: ImportSource | null;
  name?: string;
  homepage?: string;
  platforms?: string[];
  requiresLicenseAgreement?: boolean | string | null;
  openLicense?: boolean;
  digest?: string;
  keepExisting?: boolean;
  formulaDir?: string;
}

function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const KNOWN_FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc', 'dfont'];

/** Ruby CreateFormula's `[wght,ital]` filename pattern for variable axes. */
export function extractVariableAxesFromName(filePath: string): string[] | null {
  const match = filePath.match(/\[([a-zA-Z][a-zA-Z0-9,\s]*)\]/);
  if (!match) return null;
  return match[1]!.split(',').map((s) => s.trim());
}

/** Creates a formula from an archive URL or local path (Ruby CreateFormula). */
export class CreateFormula {
  private readonly downloader: Downloader;

  constructor(
    private readonly ctx: FontistContext,
    private readonly url: string,
    private readonly options: CreateFormulaOptions = {},
  ) {
    const cache = new DownloadCache(ctx, options.importCache ?? null);
    this.downloader = new Downloader(ctx, cache);
  }

  async call(): Promise<string> {
    const archive = await this.download(this.url);
    const extraction = await RecursiveExtraction.create(this.ctx, archive, {
      subdir: this.options.subdir,
      filePattern: this.options.filePattern,
      namePrefix: this.options.namePrefix,
      verbose: this.options.verbose,
    });

    const builder = new FormulaBuilder({ ui: this.ctx.ui, argv: process.argv.slice(2) });
    builder.options = {
      name: this.options.name,
      platforms: this.options.platforms,
      homepage: this.options.homepage,
      schemaVersion: this.options.schemaVersion,
      requiresLicenseAgreement: this.options.requiresLicenseAgreement,
      openLicense: this.options.openLicense,
      digest: this.options.digest,
      formulaDir: this.options.formulaDir,
      keepExisting: this.options.keepExisting,
      importSource: this.options.importSource ?? null,
    };
    builder.importSource = this.options.importSource ?? null;
    builder.resources = await this.resources(archive, extraction);
    builder.fontVersion = this.extractFontVersion(extraction);
    builder.operations = extraction.getOperations();
    builder.fontFiles = extraction.getFonts();
    builder.fontCollectionFiles = extraction.getFontCollectionFiles();
    builder.licenseText = extraction.getLicenseText();
    builder.errorCollector = extraction.errorCollector;

    return builder.save();
  }

  /** Version from the first font file; all fonts in a formula share it. */
  private extractFontVersion(extraction: RecursiveExtraction): string | null {
    const fontFile = extraction.getFonts()[0];
    if (!fontFile) return null;
    return fontFile.version;
  }

  private async resources(archive: string, extraction: RecursiveExtraction): Promise<Record<string, unknown>> {
    return { [path.basename(archive)]: await this.resourceOptions(archive, extraction) };
  }

  private async resourceOptions(
    archive: string,
    extraction: RecursiveExtraction,
  ): Promise<Record<string, unknown>> {
    const base = this.options.skipSha
      ? { urls: [this.url, ...this.mirrors()], file_size: this.fileSize(archive) }
      : await this.resourceOptionsWithSha(archive);

    if (this.options.schemaVersion === 5) {
      const format = this.detectFormatFromFonts(extraction);
      if (format) base['format'] = format;
      const axes = this.detectVariableAxesFromFonts(extraction);
      if (axes && axes.length > 0) base['variable_axes'] = axes;
    }
    return base;
  }

  private detectFormatFromFonts(extraction: RecursiveExtraction): string | null {
    const fontFile = extraction.getFonts()[0];
    if (!fontFile) return null;
    const ext = path.extname(fontFile.path).toLowerCase().replace('.', '');
    return KNOWN_FONT_FORMATS.includes(ext) ? ext : 'ttf';
  }

  private detectVariableAxesFromFonts(extraction: RecursiveExtraction): string[] | null {
    const fonts = [
      ...extraction.getFonts(),
      ...extraction.getFontCollectionFiles().flatMap((c) => c.fonts),
    ];
    for (const fontFile of fonts) {
      const axes = extractVariableAxesFromName(fontFile.path);
      if (axes && axes.length > 0) return axes;
    }
    return null;
  }

  private async resourceOptionsWithSha(archive: string): Promise<Record<string, unknown>> {
    const urls: string[] = [this.url];
    const shas: string[] = [fileSha256(archive)];

    for (const mirror of this.mirrors()) {
      const mirrorPath = await this.downloadMirror(mirror);
      if (!mirrorPath) continue;
      urls.push(mirror);
      shas.push(fileSha256(mirrorPath));
    }

    const uniqShas = [...new Set(shas)];
    const sha: string | string[] = uniqShas;
    if (uniqShas.length !== 1) {
      this.ctx.ui.error(`WARN: SHA256 differs (${uniqShas.join(', ')})`);
    }

    return { urls, sha256: sha, file_size: this.fileSize(archive) };
  }

  private mirrors(): string[] {
    return this.options.mirror ?? [];
  }

  private async downloadMirror(url: string): Promise<string | null> {
    try {
      return (await this.downloader.download(url)).path;
    } catch (err) {
      if (err instanceof InvalidResourceError) {
        this.ctx.ui.error(`WARN: a mirror is not found '${url}'`);
        return null;
      }
      throw err;
    }
  }

  private fileSize(archive: string): number {
    return statSync(archive).size;
  }

  private async download(url: string): Promise<string> {
    try {
      await fsp.stat(url);
      return url;
    } catch {
      // not a local file — download below
    }
    const progress = this.options.verbose ?? true;
    return (await this.downloader.download(url, { progress })).path;
  }
}
