import * as path from 'node:path';
import type { FontistContext } from '../context.js';
import type { Resource } from '../formula/models.js';
import {
  InvalidResourceError,
  UnsupportedMacOSVersionError,
  WindowsFodInstallError,
} from '../errors/errors.js';
import { Archive } from '../extract/archive.js';
import { Downloader } from '../download/downloader.js';

export interface ResourceInstallOptions {
  noProgress?: boolean;
}

/** Installs the files of a resource: downloads, extracts, and yields each
 * candidate font file path to the consumer callback. */
export abstract class ResourceInstaller {
  constructor(
    protected readonly ctx: FontistContext,
    protected readonly resource: Resource,
    protected readonly options: ResourceInstallOptions,
  ) {}

  /** Extracts the resource and invokes `onFile` per candidate file. */
  abstract files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void>;

  protected async download(urls: string[], sha256: string[], fileSize: number | null): Promise<string> {
    const downloader = new Downloader(this.ctx);
    const errors: string[] = [];
    for (const url of urls) {
      this.ctx.ui.say(`Downloading from ${url}`);
      try {
        const result = await downloader.download(url, {
          sha256: sha256.length > 0 ? sha256 : undefined,
          fileSize,
          progress: !this.options.noProgress,
        });
        return result.path;
      } catch (err) {
        if (err instanceof InvalidResourceError) {
          errors.push(err.message);
          this.ctx.ui.say(err.message);
          continue;
        }
        throw err;
      }
    }
    throw new InvalidResourceError(errors.join(' '));
  }
}

/** Generic archive resource: recursive extraction (Ruby ArchiveResource). */
export class ArchiveResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    void sourceNames;
    const archivePath = await this.download(this.resource.urls, this.resource.sha256, this.resource.fileSize);
    const archive = new Archive();
    const tmpDir = `${archivePath}-extracted`;
    const extracted = await archive.extractAll(archivePath, tmpDir, { recursivePackages: true });
    for (const file of extracted) {
      await onFile(file);
    }
  }
}

/** Google Fonts resource: `resource.files` are direct font URLs; matched by
 * source filename and downloaded individually (no archives involved). */
export class GoogleResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    const urls = this.resource.files.filter((url) =>
      sourceNames.includes(path.basename(url)),
    );
    for (const url of urls) {
      this.ctx.ui.say(`Downloading from ${url}`);
      const downloader = new Downloader(this.ctx);
      const result = await downloader.download(url, { progress: !this.options.noProgress });
      await onFile(result.path);
    }
  }
}

/** Apple CDN resource: plain URL download into the macOS system location. */
export class AppleCdnResourceInstaller extends ResourceInstaller {
  async files(sourceNames: string[], onFile: (filePath: string) => Promise<void>): Promise<void> {
    if (this.ctx.platform !== 'macos') {
      throw new UnsupportedMacOSVersionError(
        'apple_cdn resources are only supported on macOS; use FONTIST_PLATFORM_OVERRIDE to test.',
      );
    }
    const archivePath = await this.download(this.resource.urls, this.resource.sha256, this.resource.fileSize);
    const archive = new Archive();
    const tmpDir = `${archivePath}-extracted`;
    const extracted = await archive.extractAll(archivePath, tmpDir, { recursivePackages: true });
    for (const file of extracted) {
      if (sourceNames.length === 0 || sourceNames.includes(path.basename(file))) {
        await onFile(file);
      }
    }
  }
}

/** Windows Font-on-Demand resource: payload assembly is not supported yet. */
export class WindowsFodResourceInstaller extends ResourceInstaller {
  async files(_sourceNames: string[], _onFile: (filePath: string) => Promise<void>): Promise<void> {
    throw new WindowsFodInstallError(
      'Windows Font-on-Demand resources require the FOD payload pipeline, ' +
        'which is not available in this release (see TODO.impl/21-resource-sources.md).',
    );
  }
}

/** Registry keyed by the formula resource `source` (OCP: new sources
 * register here; the installer pipeline is untouched). */
export class ResourceInstallerRegistry {
  private readonly factories = new Map<
    string,
    new (ctx: FontistContext, resource: Resource, options: ResourceInstallOptions) => ResourceInstaller
  >();

  constructor() {
    this.register('archive', ArchiveResourceInstaller);
    this.register('google', GoogleResourceInstaller);
    this.register('apple_cdn', AppleCdnResourceInstaller);
    this.register('windows_fod', WindowsFodResourceInstaller);
  }

  register(
    source: string,
    factory: new (ctx: FontistContext, resource: Resource, options: ResourceInstallOptions) => ResourceInstaller,
  ): this {
    this.factories.set(source, factory);
    return this;
  }

  create(
    source: string | null,
    ctx: FontistContext,
    resource: Resource,
    options: ResourceInstallOptions,
  ): ResourceInstaller {
    const key = source ?? 'archive';
    const factory = this.factories.get(key);
    if (!factory) {
      throw new InvalidResourceError(`No resource installer registered for source "${key}"`);
    }
    return new factory(ctx, resource, options);
  }
}
