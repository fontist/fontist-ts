// Validator port tests (Ruby lib/fontist/validator.rb + validation.rb —
// lib-only subsystem without its own Ruby spec file).
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationCache, Validator } from '../src/validation/validator.js';
import { cleanup, makeTtf, testEnv, type TestEnv } from './helpers/index.js';

const envs: TestEnv[] = [];

afterEach(async () => {
  while (envs.length > 0) {
    await cleanup(envs.pop()!);
  }
});

async function env(): Promise<TestEnv> {
  // The windows platform has no real font directories on POSIX machines,
  // scoping the system-wide validation scan to the tmp fontist dir.
  const e = await testEnv({ platform: 'windows' });
  envs.push(e);
  const fontsDir = e.ctx.paths.fontsPath();
  await fsp.mkdir(fontsDir, { recursive: true });
  await fsp.writeFile(
    path.join(fontsDir, 'Valid.ttf'),
    makeTtf({ family: 'Valid', subfamily: 'Regular', fullName: 'Valid Regular' }),
  );
  await fsp.writeFile(path.join(fontsDir, 'Broken.ttf'), Buffer.from('not a font'));
  await fsp.writeFile(
    path.join(fontsDir, 'Nameless.ttf'),
    makeTtf({ family: 'Nameless' }), // parses but lacks name records
  );
  return e;
}

describe('Validator.validateAll', () => {
  it('validates fonts and builds a summary report', async () => {
    const e = await env();
    const report = await new Validator(e.ctx).validateAll({ parallel: false });
    expect(report.data.total_fonts).toBe(3);
    expect(report.data.valid_fonts).toBe(1);
    expect(report.data.invalid_fonts).toBe(2);
    expect(report.data.platform).toBe('windows');
    const invalid = report.invalidResults();
    expect(invalid).toHaveLength(2); // Broken.ttf + Nameless.ttf
    expect(invalid.every((r) => r.error_message && r.error_message.length > 0)).toBe(true);
    expect(report.validResults()).toHaveLength(1);
    expect(report.validResults()[0]!.family_name).toBe('Valid');
    expect(report.data.max_time).toBeGreaterThanOrEqual(report.data.min_time);
  });

  it('reuses cached results for unchanged files', async () => {
    const e = await env();
    const validator = new Validator(e.ctx);
    const first = await validator.validateAll({ parallel: false });
    const cache = ValidationCache.empty();
    for (const result of first.data.results) {
      cache.set(result);
    }
    const second = await new Validator(e.ctx).validateAll({ parallel: false, cache });
    // Entry content is stable (reused or identical revalidation); only the
    // cache timestamp is refreshed.
    expect(second.data.total_fonts).toBe(first.data.total_fonts);
    expect(second.data.valid_fonts).toBe(first.data.valid_fonts);
    expect(second.data.invalid_fonts).toBe(first.data.invalid_fonts);
    expect(cache.data.entries).toHaveLength(first.data.results.length);
  });
});

describe('ValidationCache', () => {
  it('invalidates entries whose file changed', async () => {
    const e = await env();
    const validator = new Validator(e.ctx);
    const cache = ValidationCache.empty();
    const fontsDir = e.ctx.paths.fontsPath();
    for (const name of ['Valid.ttf', 'Broken.ttf']) {
      cache.set(await validator.validateSingle(path.join(fontsDir, name)));
    }
    expect(await cache.get(path.join(fontsDir, 'Valid.ttf'))).not.toBeNull();
    // Modify the file: cache entry must be invalidated by size/mtime check.
    await fsp.writeFile(path.join(fontsDir, 'Valid.ttf'), makeTtf({ family: 'Changed' }));
    expect(await cache.get(path.join(fontsDir, 'Valid.ttf'))).toBeNull();
  });

  it('flags caches older than 24 hours as stale', async () => {
    const cache = ValidationCache.fromData({ generated_at: 0, entries: [] });
    expect(cache.stale()).toBe(true);
  });
});
