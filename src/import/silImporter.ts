import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import { SilImportSource } from '../formula/importSources.js';
import { browserHeaders, randomBrowserProfile } from '../download/userAgent.js';
import { CreateFormula } from './createFormula.js';
import { ImportDisplay } from './importDisplay.js';
import { anchorsMatchingSelector, extractAnchors, type HtmlNode } from './helpers/htmlWalk.js';

const ROOT = 'https://software.sil.org/fonts/';

const INDEX_PAGES = [
  'Arabic Fonts',
  'Latin, Greek, and Cyrillic Fonts',
  'African Latin Fonts',
  'Asian Latin Fonts',
];

export interface SilImportOptions {
  outputPath?: string;
  fontName?: string;
  verbose?: boolean;
  importCache?: string;
  force?: boolean;
  schemaVersion?: number;
  /** Catalog root; injectable so tests run against a local server. */
  rootUrl?: string;
  /** Injectable page fetcher for hermetic tests. */
  fetchPage?: (url: string) => Promise<string>;
}

export interface SilImportResults {
  successful: number;
  failed: number;
  skipped: number;
  overwritten: number;
  errors: string[];
  duration: number;
}

interface FontLink {
  content: string;
  href: string;
}

/** Imports SIL International fonts by scraping the SIL fonts catalog
 * (Ruby SilImporter). All SIL fonts use the SIL Open Font License. */
export class SilImporter {
  private readonly options: SilImportOptions;
  private readonly ctx: FontistContext;
  private readonly root: string;

  private successCount = 0;
  private failureCount = 0;
  private skippedCount = 0;
  private overwrittenCount = 0;
  private readonly failures: Array<{ name: string; reason: string }> = [];

  constructor(ctx: FontistContext, options: SilImportOptions = {}) {
    this.ctx = ctx;
    this.options = options;
    this.root = options.rootUrl ?? ROOT;
  }

  async call(): Promise<SilImportResults> {
    const startTime = Date.now();

    this.displayHeader();
    const links = await this.fetchAndFilterFonts();
    if (links.length === 0) {
      return this.emptyResult();
    }

    await this.processFonts(links);
    return this.buildResults(Date.now() - startTime);
  }

  private displayHeader(): void {
    if (this.options.verbose) {
      ImportDisplay.header(
        'SIL International Fonts',
        { output_path: this.formulaDir(), font_filter: this.options.fontName },
        { importCache: this.options.importCache ?? this.ctx.paths.importCachePath(this.ctx.env) },
      );
    }
  }

  private async fetchAndFilterFonts(): Promise<FontLink[]> {
    if (this.options.verbose) {
      this.ctx.ui.say('Fetching font list from SIL website...');
      this.ctx.ui.say('');
    }

    let links = await this.fontLinks();

    if (this.options.verbose) {
      this.ctx.ui.say(`Found ${links.length} fonts on SIL website`);
    }

    if (this.options.fontName) {
      links = this.filterByFontName(links, this.options.fontName);
      if (this.options.verbose) {
        this.ctx.ui.say(`Filter: ${this.options.fontName}`);
        this.ctx.ui.say(`Filtered to ${links.length} fonts matching filter`);
      }
      if (links.length === 0) {
        this.ctx.ui.error(`No fonts matching '${this.options.fontName}' found`);
      }
    }

    if (this.options.verbose) {
      this.ctx.ui.say(`Saving formulas to: ${this.formulaDir()}`);
      this.ctx.ui.say('');
    }

    return links;
  }

  private async fontLinks(): Promise<FontLink[]> {
    const html = await this.fetchPage(this.root);
    return anchorsMatchingSelector(extractAnchors(html), 'table.products div.title > a')
      .filter((a): a is HtmlNode & { href: string } => a.href !== null)
      .map((a) => ({ content: a.text, href: a.href }));
  }

  private filterByFontName(links: FontLink[], fontName: string): FontLink[] {
    const needle = fontName.toLowerCase();
    return links.filter((link) => link.content.toLowerCase().includes(needle));
  }

  private async processFonts(links: FontLink[]): Promise<void> {
    let current = 0;
    for (const link of links) {
      current += 1;
      await this.processSingleFont(link, current, links.length);
    }
  }

  private async processSingleFont(link: FontLink, current: number, total: number): Promise<void> {
    const familyName = link.content;

    if (this.options.verbose) {
      ImportDisplay.progress(current, total, familyName);
    }

    const url = await this.findArchiveUrlByPageLink(link);
    if (!url) return;

    try {
      const version = extractVersionFromUrl(url);
      const importSource = createImportSource(version);
      const path = await this.createFormulaByArchiveUrl(url, importSource);
      if (!path) {
        this.failureCount += 1;
        this.failures.push({ name: familyName, reason: 'Formula creation failed' });
        return;
      }

      const stats = await fsp.stat(path);
      const wasJustCreated = Date.now() - stats.mtimeMs < 2000;
      const formulaName = path.split('/').pop() ?? path;
      if (wasJustCreated) {
        this.successCount += 1;
        if (this.options.verbose) {
          this.ctx.ui.say(`  ✓ Formula created: ${formulaName}`);
        }
      } else {
        this.skippedCount += 1;
        if (this.options.verbose) {
          this.ctx.ui.say(`  ⊝ Skipped (already exists): ${formulaName}`);
          this.ctx.ui.say('    ℹ Use --force to overwrite existing formulas');
        }
      }
    } catch (err) {
      this.failureCount += 1;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const reason = rawMessage.length > 60 ? `${rawMessage.slice(0, 60)}...` : rawMessage;
      this.failures.push({ name: familyName, reason });
      if (this.options.verbose) {
        this.ctx.ui.say(`  ✗ Failed: ${reason}`);
      }
    }
  }

  private async createFormulaByArchiveUrl(url: string, importSource: SilImportSource | null): Promise<string | null> {
    return new CreateFormula(this.ctx, url, {
      formulaDir: this.formulaDir(),
      importSource: importSource ?? undefined,
      importCache: this.options.importCache,
      keepExisting: !this.options.force,
      schemaVersion: this.options.schemaVersion ?? 4,
      openLicense: true,
    }).call();
  }

  private isIndexPage(name: string): boolean {
    const stripped = name.trim().toLowerCase();
    return INDEX_PAGES.some((page) => page.toLowerCase() === stripped);
  }

  private async findArchiveUrlByPageLink(link: FontLink): Promise<string | null> {
    const familyName = link.content;

    if (this.isIndexPage(familyName)) {
      if (this.options.verbose) {
        this.ctx.ui.say(`  ⊝ Skipped (index page): ${familyName}`);
      }
      return null;
    }

    if (!this.options.verbose) {
      process.stdout.write(`Searching for an archive of ${familyName}... `);
    }

    const pageUrl = new URL(link.href, this.root).toString();
    ImportDisplay.pageUrl(pageUrl);

    const archiveUrl = await this.findArchiveUrlByPageUri(pageUrl);
    if (!archiveUrl) {
      if (this.options.verbose) {
        this.ctx.ui.say('  ✗ No archive found');
      } else {
        this.ctx.ui.error('NOT FOUND');
      }
      return null;
    }

    ImportDisplay.downloadUrl(archiveUrl);
    if (!this.options.verbose) {
      process.stdout.write('DONE\n');
    }
    return archiveUrl;
  }

  private async findArchiveUrlByPageUri(uri: string, depth = 0): Promise<string | null> {
    const html = await this.fetchPage(uri);
    const document = extractAnchors(html);

    if (this.options.verbose) {
      ImportDisplay.foundElements(anchorsMatchingSelector(document, 'a.btn-download').length, 'a.btn-download');
    }

    const link = this.findArchiveLink(document);
    if (link) return new URL(link, uri).toString();

    const pageLink = this.findDownloadPage(document);
    if (this.options.verbose && pageLink) {
      ImportDisplay.followingLink("'DOWNLOADS' page link");
    }
    if (!pageLink || depth > 2) return null;

    const nextPage = new URL(pageLink, uri).toString();
    return this.findArchiveUrlByPageUri(nextPage, depth + 1);
  }

  /** Ruby find_archive_link: btn-download → .zip, "DOWNLOAD CURRENT
   * VERSION", getfile → .zip, any "Download*.zip" text. */
  private findArchiveLink(anchors: HtmlNode[]): string | null {
    const btnDownloads = anchorsMatchingSelector(anchors, 'a.btn-download');
    const zipBtn = btnDownloads.find((a) => a.href?.endsWith('.zip'));
    if (zipBtn?.href) return zipBtn.href;

    const currentVersion = btnDownloads.find((a) => a.text.includes('DOWNLOAD CURRENT VERSION'));
    if (currentVersion?.href) return currentVersion.href;

    const getfiles = anchorsMatchingSelector(anchors, 'a.getfile');
    const zipGetfile = getfiles.find((a) => a.href?.endsWith('.zip'));
    if (zipGetfile?.href) return zipGetfile.href;

    const anyZip = anchors.find((a) => /Download.*\.zip/.test(a.text));
    return anyZip?.href ?? null;
  }

  private findDownloadPage(anchors: HtmlNode[]): string | null {
    const pageLinks = anchorsMatchingSelector(anchors, 'a.btn-download').filter((tag) =>
      /^DOWNLOADS?$/i.test(tag.text.trim()),
    );
    return pageLinks[0]?.href ?? null;
  }

  private emptyResult(): SilImportResults {
    return { successful: 0, failed: 0, skipped: 0, overwritten: 0, errors: [], duration: 0 };
  }

  private buildResults(duration: number): SilImportResults {
    return {
      successful: this.successCount,
      failed: this.failureCount,
      skipped: this.skippedCount,
      overwritten: this.overwrittenCount,
      errors: this.failures.map((f) => `${f.name}: ${f.reason}`),
      duration,
    };
  }

  private formulaDir(): string {
    const dir = this.options.outputPath
      ? this.options.outputPath
      : path.join(this.ctx.paths.formulasPath(), 'sil');
    return dir;
  }

  private fetchPage(url: string): Promise<string> {
    if (this.options.fetchPage) return this.options.fetchPage(url);
    return fetch(url, { headers: browserHeaders(randomBrowserProfile()) }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }
      return response.text();
    });
  }
}

/** Extracts a version like 6.200 / 1.0.0 from an archive URL
 * (Ruby extract_version_from_url). */
export function extractVersionFromUrl(url: string): string | null {
  const match = url.match(/[-_]v?(\d+\.\d+(?:\.\d+)?)(?:[-_.]|\.zip|\.tar)/i);
  if (match) return match[1]!;
  const fallback = url.match(/(\d+\.\d+\.\d+|\d+\.\d+)/);
  return fallback ? fallback[1]! : null;
}

function createImportSource(version: string | null): SilImportSource | null {
  if (!version) return null;
  return new SilImportSource({
    type: 'sil',
    version,
    release_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}
