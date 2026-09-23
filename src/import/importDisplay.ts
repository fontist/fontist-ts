/** Plain-text display helpers for import flows (Ruby ImportDisplay; color
 * output from the Paint gem is not reproduced). */
export class ImportDisplay {
  static header(title: string, details: Record<string, string | undefined>, options: { importCache?: string } = {}): void {
    process.stdout.write('');
    process.stdout.write('─'.repeat(80) + '\n');
    process.stdout.write(`  ${title}\n`);
    process.stdout.write('─'.repeat(80) + '\n');
    process.stdout.write('\n');
    if (options.importCache) {
      process.stdout.write(`  Import cache: ${options.importCache}\n`);
    }
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined) {
        process.stdout.write(`  ${key}: ${value}\n`);
      }
    }
    process.stdout.write('\n');
  }

  static progress(current: number, total: number, name: string): void {
    const percentage = ((current / total) * 100).toFixed(1);
    process.stdout.write(`(${current}/${total}) ${percentage}% | ${name}\n`);
  }

  static pageUrl(url: string): void {
    process.stdout.write(`    Page: ${url}\n`);
  }

  static downloadUrl(url: string): void {
    process.stdout.write(`    Archive: ${url}\n`);
  }

  static foundElements(count: number, selector: string): void {
    process.stdout.write(`    Found ${count} elements for ${selector}\n`);
  }

  static debugInfo(message: string): void {
    process.stdout.write(`  ${message}\n`);
  }

  static error(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  static followingLink(label: string): void {
    process.stdout.write(`    Following ${label}...\n`);
  }
}
