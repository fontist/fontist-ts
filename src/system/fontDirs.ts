import * as os from 'node:os';
import * as path from 'node:path';
import type { FontistPlatform } from '../ui/ui.js';

/** The platform's user font directory (without Fontist's `fontist`
 * suffix). Shared by system-font discovery and the user install location. */
export function defaultUserFontPath(platform: FontistPlatform, env: NodeJS.ProcessEnv): string {
  switch (platform) {
    case 'macos':
      return path.join(os.homedir(), 'Library', 'Fonts');
    case 'linux':
      return path.join(os.homedir(), '.local', 'share', 'fonts');
    case 'windows': {
      const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(localAppData, 'Microsoft', 'Windows', 'Fonts');
    }
  }
}
