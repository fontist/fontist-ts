// Mirrors spec/fontist/system_font_spec.rb (Ruby gem).
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SystemFont } from '../../src/system/systemFont.js';
import { cleanup, makeTtf, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  const fontsDir = e.ctx.paths.fontsPath();
  await fsp.mkdir(fontsDir, { recursive: true });
  await fsp.writeFile(
    path.join(fontsDir, 'SysSans.ttf'),
    makeTtf({ family: 'Sys Sans', subfamily: 'Regular', fullName: 'Sys Sans Regular' }),
  );
  await fsp.writeFile(
    path.join(fontsDir, 'SysSansBold.ttf'),
    makeTtf({ family: 'Sys Sans', subfamily: 'Bold', fullName: 'Sys Sans Bold' }),
  );
  return e;
}

describe('SystemFont.find', () => {
  it('returns the complete font paths', async () => {
    const e = await env();
    const paths = await new SystemFont(e.ctx).find('Sys Sans');
    expect(paths).toHaveLength(2);
    expect(paths!.every((p) => p.endsWith('.ttf'))).toBe(true);
  });

  it('returns nil to the caller for absent fonts', async () => {
    const e = await env();
    expect(await new SystemFont(e.ctx).find('Absent Font')).toBeNull();
  });

  it('returns only the requested style', async () => {
    const e = await env();
    const styles = await new SystemFont(e.ctx).findStyles('Sys Sans', 'Bold');
    expect(styles).toHaveLength(1);
    expect(styles![0]!.subfamily).toBe('Bold');
  });
});
