export type FontistPlatform = 'macos' | 'linux' | 'windows';

export interface UiWriter {
  write(text: string): void;
}

export type UiLevel = 'debug' | 'info' | 'fatal';

export interface UiOptions {
  out?: UiWriter;
  err?: UiWriter;
  tty?: boolean;
  level?: UiLevel;
}

function streamWriter(stream: NodeJS.WriteStream): UiWriter {
  return { write: (text: string) => stream.write(text) };
}

export class UI {
  private readonly out: UiWriter;
  private readonly err: UiWriter;
  private readonly tty: boolean;
  private level: UiLevel;
  private progressActive = false;

  constructor(options: UiOptions = {}) {
    this.out = options.out ?? streamWriter(process.stdout);
    this.err = options.err ?? streamWriter(process.stderr);
    this.tty = options.tty ?? process.stdout.isTTY === true;
    this.level = options.level ?? 'info';
  }

  setLevel(level: UiLevel): void {
    this.level = level;
  }

  say(message: string): void {
    if (this.level === 'fatal') return;
    this.clearProgressLine();
    this.out.write(`${message}\n`);
  }

  error(message: string): void {
    if (this.level === 'fatal') return;
    this.clearProgressLine();
    this.err.write(`${message}\n`);
  }

  warn(message: string): void {
    this.say(message);
  }

  debug(message: string): void {
    if (this.level !== 'debug') return;
    this.clearProgressLine();
    this.out.write(`${message}\n`);
  }

  isProgressVisible(): boolean {
    return this.tty;
  }

  /** Single-line progress, mirroring the Ruby downloader's output. */
  progress(ratio: number, doneMiB: number, totalMiB: number | null): void {
    if (!this.tty) return;
    const percent = Math.min(100, Math.floor(ratio * 100));
    const total = totalMiB === null ? '?' : totalMiB.toFixed(1);
    this.out.write(`\r\x1b[0KDownloading: ${percent}% (${doneMiB.toFixed(1)}/${total} MiB)`);
    this.progressActive = true;
  }

  clearProgressLine(): void {
    if (!this.progressActive) return;
    this.progressActive = false;
    if (this.tty) {
      this.out.write('\r\x1b[0K\n');
    }
  }

  async ask(question: string): Promise<string> {
    this.clearProgressLine();
    this.out.write(question);
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question('');
    } finally {
      rl.close();
    }
  }
}
