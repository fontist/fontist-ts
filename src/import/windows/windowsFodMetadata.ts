import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as yaml from 'yaml';

const DATA_PATH = fileURLToPath(new URL('./fod_capabilities.yml', import.meta.url));

interface CapabilityFontData {
  [familyName: string]: Record<string, unknown>;
}

interface CapabilityData {
  description?: string;
  fonts?: CapabilityFontData;
}

interface FodMetadata {
  capabilities?: Record<string, CapabilityData>;
}

/** Metadata for Windows Features on Demand font capabilities: maps between
 * capability names and font families (Ruby WindowsFodMetadata). */
export class WindowsFodMetadata {
  private static cache: FodMetadata | null = null;
  private static reverse: Map<string, string> | null = null;

  /** Font family name → capability name (case-insensitive). */
  static capabilityForFont(fontName: string): string | null {
    return WindowsFodMetadata.reverseMap().get(fontName.toLowerCase()) ?? null;
  }

  static fontsForCapability(capName: string): CapabilityFontData | null {
    return WindowsFodMetadata.data().capabilities?.[capName]?.fonts ?? null;
  }

  static descriptionForCapability(capName: string): string | null {
    return WindowsFodMetadata.data().capabilities?.[capName]?.description ?? null;
  }

  static allFontNames(): string[] {
    return Object.values(WindowsFodMetadata.data().capabilities ?? {}).flatMap(
      (data) => Object.keys(data.fonts ?? {}),
    );
  }

  static allCapabilities(): string[] {
    return Object.keys(WindowsFodMetadata.data().capabilities ?? {});
  }

  /** Raw parsed YAML metadata. */
  static data(): FodMetadata {
    if (!WindowsFodMetadata.cache) {
      WindowsFodMetadata.cache = yaml.parse(readFileSync(DATA_PATH, 'utf8')) as FodMetadata;
    }
    return WindowsFodMetadata.cache;
  }

  /** Test hook (Ruby reset_cache). */
  static resetCache(): void {
    WindowsFodMetadata.cache = null;
    WindowsFodMetadata.reverse = null;
  }

  private static reverseMap(): Map<string, string> {
    if (!WindowsFodMetadata.reverse) {
      const map = new Map<string, string>();
      for (const [capName, data] of Object.entries(WindowsFodMetadata.data().capabilities ?? {})) {
        for (const fontName of Object.keys(data.fonts ?? {})) {
          map.set(fontName.toLowerCase(), capName);
        }
      }
      WindowsFodMetadata.reverse = map;
    }
    return WindowsFodMetadata.reverse;
  }
}
