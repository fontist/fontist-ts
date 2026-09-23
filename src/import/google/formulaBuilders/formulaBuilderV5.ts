import { compact, extractCopyright, warn, type FormulaHash } from './baseFormulaBuilder.js';
import { FormulaBuilderV4 } from './formulaBuilderV4.js';

/** V5 builder: TTF + WOFF2, static + variable fonts, per-style formats
 * (Ruby FormulaBuilderV5). */
export class FormulaBuilderV5 extends FormulaBuilderV4 {
  override version(): number {
    return 5;
  }

  override async build(): Promise<FormulaHash> {
    const [licenseUrl, licenseText] = this.buildLicenseInfo();
    const fontsData = await this.buildV5Fonts();
    const github = this.githubFamily();
    return compact({
      name: this.formulaName(),
      schema_version: 5,
      description: github?.description ?? this.defaultDescription(),
      homepage: this.defaultHomepage(),
      resources: this.buildV5Resources(),
      fonts: fontsData,
      extract: {},
      copyright: extractCopyright(fontsData) ?? github?.licenseText ?? null,
      license_url: licenseUrl,
      license: licenseText,
      open_license: licenseText,
    });
  }

  private buildV5Resources(): Record<string, unknown> {
    const resources: Record<string, unknown> = {};
    const family = this.family.family ?? '';
    const isVariable = this.family.variableFont();

    if (isVariable) {
      if (Object.keys(this.deps.woff2Files.get(family) ?? {}).length > 0) {
        resources['woff2_variable'] = this.buildResourceEntry(
          this.deps.woff2Files.get(family)!,
          'woff2',
          true,
        );
      }
      if (Object.keys(this.deps.ttfFiles.get(family) ?? {}).length > 0) {
        resources['ttf_variable'] = this.buildResourceEntry(this.deps.ttfFiles.get(family)!, 'ttf', true);
      }
    } else {
      const staticTtf = this.filterStaticFiles(this.deps.ttfFiles.get(family));
      if (Object.keys(staticTtf).length > 0) {
        resources['ttf_static'] = this.buildResourceEntry(staticTtf, 'ttf', false);
      }
      const staticWoff2 = this.filterStaticFiles(this.deps.woff2Files.get(family));
      if (Object.keys(staticWoff2).length > 0) {
        resources['woff2_static'] = this.buildResourceEntry(staticWoff2, 'woff2', false);
      }
    }

    return resources;
  }

  private buildResourceEntry(
    files: Record<string, string>,
    format: string,
    variable: boolean,
  ): Record<string, unknown> {
    const urls = Object.values(files);
    const entry: Record<string, unknown> = {
      source: 'google',
      family: this.family.family,
      files: urls,
      urls,
      format: this.detectActualFormat(urls, format),
    };
    if (variable && this.family.axes) {
      entry['variable_axes'] = (this.family.axes ?? []).map((axis) => axis.tag);
    }
    return entry;
  }

  private detectActualFormat(urls: string[], declaredFormat: string): string {
    const extensions = [
      ...new Set(urls.map((url) => url.split('/').pop()?.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? '')),
    ].filter((e) => e.length > 0);
    if (extensions.length === 1 && ['ttf', 'otf', 'woff', 'woff2'].includes(extensions[0]!)) {
      return extensions[0]!;
    }
    return declaredFormat;
  }

  private filterStaticFiles(files: Record<string, string> | undefined): Record<string, string> {
    if (!files) return {};
    const out: Record<string, string> = {};
    for (const [variant, url] of Object.entries(files)) {
      if (!this.isVariableVariant(variant)) out[variant] = url;
    }
    return out;
  }

  private isVariableVariant(variant: string): boolean {
    if (variant.includes('Variable')) return true;
    if (!this.family.variableFont()) return false;
    return (this.family.axes ?? []).some((axis) => variant.includes(axis.tag ?? ''));
  }

  /** V5 parses ALL TTFs (static + variable) and adds per-style metadata. */
  private buildV5Fonts(): Promise<Array<Record<string, unknown>>> {
    const run = async (): Promise<Array<Record<string, unknown>>> => {
      const parsedFonts: Array<Record<string, unknown>> = [];
      const family = this.family.family ?? '';
      for (const [variant, url] of Object.entries(this.deps.ttfFiles.get(family) ?? {})) {
        try {
          const metadata = await this.downloadAndExtract(url);
          const filename = url.split('/').pop()!;
          const styleData = this.buildStyleData(metadata, filename);
          this.addV5StyleAttributes(styleData, variant);
          parsedFonts.push(styleData);
        } catch (err) {
          warn(`Failed to download/parse ${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (parsedFonts.length === 0) return [];
      return this.groupFontsBySubfamily(parsedFonts);
    };
    return run();
  }

  private addV5StyleAttributes(style: Record<string, unknown>, variant: string): void {
    style['formats'] = this.determineFormatsForStyle(variant);
    if (this.family.variableFont()) {
      style['variable_font'] = true;
      style['variable_axes'] = (this.family.axes ?? []).map((axis) => axis.tag);
    } else {
      style['variable_font'] = false;
    }
  }

  private determineFormatsForStyle(variant: string): string[] {
    const family = this.family.family ?? '';
    const formats: string[] = [];
    if (Object.keys(this.deps.ttfFiles.get(family) ?? {}).includes(variant)) formats.push('ttf');
    if (Object.keys(this.deps.woff2Files.get(family) ?? {}).includes(variant)) formats.push('woff2');
    return [...new Set(formats)];
  }
}
