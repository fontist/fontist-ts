import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFileSync } from 'node:fs';
import type { FontistContext } from '../context.js';
import { Archive } from '../extract/archive.js';
import { CollectionFile } from './files/collectionFile.js';
import { FontDetector } from './files/fontDetector.js';
import { ImportFontFile } from './otf/fontFile.js';
import { FontParsingErrorCollector, type FontParsingError } from './fontParsingErrorCollector.js';

/** Files matching this pattern are captured as the license text
 * (Ruby RecursiveExtraction::LICENSE_PATTERN). */
const LICENSE_PATTERN = /(ofl\.txt|ufl\.txt|licenses?\.txt|license(\.md)?|copying)$/i;

export const SUPPORTED_FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2', 'dfont'] as const;

const FONT_EXTENSIONS_PATTERN = new RegExp(`\\.(${SUPPORTED_FONT_EXTENSIONS.join('|')})$`, 'i');

export interface ExtractionOperations {
  options?: { fonts_sub_dir?: string };
}

function hasFontExtension(p: string): boolean {
  return FONT_EXTENSIONS_PATTERN.test(p);
}

function subdirectoryMatch(pattern: string | null, dir: string): boolean {
  if (!pattern) return true;
  return fnmatch(pattern, dir);
}

function filePatternMatch(pattern: string | null, file: string): boolean {
  if (!pattern) return true;
  return fnmatch(pattern, file);
}

/** Minimal glob matching for the patterns Fontist uses (`*` crosses
 * directory separators, `?` matches one char, `[...]` a character class). */
export function fnmatch(pattern: string, value: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\[([^\]]*)\]/g, (_, chars: string) => (chars.startsWith('!') ? `[^${chars.slice(1)}]` : `[${chars}]`));
  return new RegExp(`^${regex}$`).test(value);
}

/** Walks an archive recursively, collecting font files, collection files,
 * and the license text (Ruby RecursiveExtraction). */
export class RecursiveExtraction {
  readonly errorCollector = new FontParsingErrorCollector();

  private operations: ExtractionOperations = {};
  private fontFiles: ImportFontFile[] = [];
  private collectionFiles: CollectionFile[] = [];
  private licenseText: string | null = null;
  private extracted = false;

  private constructor(
    private readonly ctx: FontistContext,
    private readonly archivePath: string,
    private readonly options: {
      subdir?: string;
      filePattern?: string;
      namePrefix?: string;
      verbose?: boolean;
    } = {},
  ) {
    if (options.subdir) {
      this.operations.options = { fonts_sub_dir: options.subdir };
    }
  }

  /** Extracts the archive and collects fonts/license. Results are available
   * through the getters afterwards. */
  static async create(
    ctx: FontistContext,
    archivePath: string,
    options: {
      subdir?: string;
      filePattern?: string;
      namePrefix?: string;
      verbose?: boolean;
    } = {},
  ): Promise<RecursiveExtraction> {
    const extraction = new RecursiveExtraction(ctx, archivePath, options);
    await extraction.run();
    return extraction;
  }

  getFonts(): ImportFontFile[] {
    this.ensureExtracted();
    return this.fontFiles;
  }

  getFontCollectionFiles(): CollectionFile[] {
    this.ensureExtracted();
    return this.collectionFiles;
  }

  getLicenseText(): string | null {
    this.ensureExtracted();
    return this.licenseText;
  }

  getOperations(): ExtractionOperations {
    this.ensureExtracted();
    return this.operations;
  }

  private ensureExtracted(): void {
    if (!this.extracted) {
      throw new Error('RecursiveExtraction.create() must be awaited before reading results');
    }
  }

  /** Extracts and collects; must be called before the getters. */
  private subdirectoryPattern(): string | null {
    if (!this.options.subdir) return null;
    return `*${this.options.subdir.replace(/\/$/, '')}`;
  }

  private async run(): Promise<void> {
    if (this.extracted) return;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fontist-import-'));
    try {
      const archive = new Archive();
      const files = await archive.extractAll(this.archivePath, tempDir, { recursivePackages: true });
      for (const file of files.sort()) {
        let stat;
        try {
          stat = await fsp.stat(file);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;

        if (!this.licenseText && LICENSE_PATTERN.test(file)) {
          this.licenseText = readFileSync(file, 'utf8');
        }
        if (!this.fontCandidate(file)) continue;
        await this.matchFont(file);
      }
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
    this.extracted = true;
  }

  private fontCandidate(file: string): boolean {
    return (
      hasFontExtension(file) &&
      subdirectoryMatch(this.subdirectoryPattern(), path.dirname(file)) &&
      filePatternMatch(this.options.filePattern ?? null, path.basename(file))
    );
  }

  private async matchFont(file: string): Promise<void> {
    const kind = await FontDetector.detect(file, this.errorCollector);
    if (kind === 'font') {
      const candidate = new ImportFontFile(file, {
        namePrefix: this.options.namePrefix ?? null,
        ui: this.ctx.ui,
      });
      if (!this.alreadyExist(candidate)) {
        this.fontFiles.push(candidate);
      }
    } else if (kind === 'collection') {
      const collection = CollectionFile.fromPath(file, {
        namePrefix: this.options.namePrefix ?? null,
        errorCollector: this.errorCollector,
        ui: this.ctx.ui,
      });
      if (collection) {
        this.collectionFiles.push(collection);
      } else {
        this.ctx.ui.debug(`Skipping unparseable collection: ${path.basename(file)}`);
      }
    }
  }

  private alreadyExist(candidate: ImportFontFile): boolean {
    return this.fontFiles.some(
      (file) =>
        file.familyName === candidate.familyName &&
        file.type === candidate.type &&
        file.version === candidate.version &&
        file.font === candidate.font,
    );
  }

  parsingErrors(): FontParsingError[] {
    return this.errorCollector.errors;
  }
}
