import { BaseFormulaBuilder, compact, extractCopyright, warn, type FormulaHash } from './baseFormulaBuilder.js';

/** V4 builder: TTF only, static fonts only (Ruby FormulaBuilderV4). */
export class FormulaBuilderV4 extends BaseFormulaBuilder {
  override version(): number {
    return 4;
  }

  override async build(): Promise<FormulaHash> {
    const [licenseUrl, licenseText] = this.buildLicenseInfo();
    const fontsData = await this.buildFonts();
    const github = this.githubFamily();
    return compact({
      name: this.formulaName(),
      description: github?.description ?? this.defaultDescription(),
      homepage: this.defaultHomepage(),
      resources: this.buildResources(),
      fonts: fontsData,
      extract: {},
      copyright: extractCopyright(fontsData) ?? github?.licenseText ?? null,
      license_url: licenseUrl,
      license: licenseText,
      open_license: licenseText,
    });
  }

  private buildResources(): Record<string, unknown> | null {
    const family = this.family.family ?? '';
    const files: string[] = [];
    for (const url of Object.values(this.deps.ttfFiles.get(family) ?? {})) {
      files.push(url);
    }
    if (files.length === 0) return null;

    const resource: Record<string, unknown> = {
      source: 'google',
      family,
      files,
      format: 'ttf',
    };
    if (this.family.variableFont()) {
      resource['variable_axes'] = (this.family.axes ?? []).map((axis) => axis.tag);
    }
    return { [family]: resource };
  }

  /** Downloads each TTF and extracts full metadata; variable fonts skipped. */
  private async buildFonts(): Promise<Array<Record<string, unknown>>> {
    const parsedFonts: Array<Record<string, unknown>> = [];
    const family = this.family.family ?? '';
    for (const url of Object.values(this.deps.ttfFiles.get(family) ?? {})) {
      try {
        const metadata = await this.downloadAndExtract(url);
        if (metadata.isVariable) continue;
        const filename = url.split('/').pop()!;
        parsedFonts.push(this.buildStyleData(metadata, filename));
      } catch (err) {
        warn(`Failed to download/parse ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (parsedFonts.length === 0) return [];
    return this.groupFontsBySubfamily(parsedFonts);
  }
}
