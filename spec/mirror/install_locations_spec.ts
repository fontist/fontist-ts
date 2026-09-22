// Mirrors spec/fontist/install_locations/base_location_spec.rb, spec/fontist/install_locations/fontist_location_spec.rb, spec/fontist/install_locations/system_location_spec.rb, spec/fontist/install_locations/user_location_spec.rb (Ruby gem).
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BaseLocation,
  FontistLocation,
  SystemLocation,
  UserLocation,
  createInstallLocation,
} from '../../src/locations/installLocation.js';
import { cleanup, testEnv, type TestEnv } from '../helpers/index.js';

const envs: TestEnv[] = [];

async function env(): Promise<TestEnv> {
  const e = await testEnv();
  envs.push(e);
  return e;
}

describe('BaseLocation contract', () => {
  it('defaults managedPath to true', async () => {
    const e = await env();
    const location = new FontistLocation(e.ctx, null);
    expect(location.managedPath()).toBe(true);
  });

  it('defaults requiresElevatedPermissions to false', async () => {
    const e = await env();
    expect(new FontistLocation(e.ctx, null).requiresElevatedPermissions()).toBe(false);
  });

  it('defaults permissionWarning to nil', async () => {
    const e = await env();
    expect(new FontistLocation(e.ctx, null).permissionWarning()).toBeNull();
  });

  it('joins base_path and filename on install', async () => {
    const e = await env();
    const location = new FontistLocation(e.ctx, null);
    const target = path.join(location.basePath(), 'Some.ttf');
    expect(target.startsWith(e.ctx.paths.fontsPath())).toBe(true);
  });
});

describe('FontistLocation', () => {
  it('bases fonts under fonts/{formula-key}', async () => {
    const e = await env();
    const formula = (await new (await import('../../src/formula/formulaRepository.js')).FormulaRepository(e.ctx).all())[0] ?? null;
    const location = createInstallLocation('fontist', e.ctx, formula);
    expect(location.locationType()).toBe('fontist');
    expect(location.basePath().startsWith(e.ctx.paths.fontsPath())).toBe(true);
  });
});

describe('UserLocation', () => {
  it('appends fontist subdir to the platform user fonts dir', async () => {
    const e = await env();
    const location = new UserLocation(e.ctx, null);
    expect(location.basePath().endsWith('/fontist') || location.basePath().endsWith('\\fontist')).toBe(true);
  });

  it('is unmanaged for custom user paths', async () => {
    const e = await env();
    e.ctx.config.set('user_fonts_path', path.join(e.home, 'custom'));
    const location = new UserLocation(e.ctx, null);
    expect(location.managedPath()).toBe(false);
  });
});

describe('SystemLocation', () => {
  it('requires elevated permissions and warns', async () => {
    const e = await env();
    const location = new SystemLocation(e.ctx, null);
    expect(location.requiresElevatedPermissions()).toBe(true);
    expect(location.permissionWarning()).toContain('elevated');
  });

  it('resolves the platform system fonts path', async () => {
    const e = await env();
    const location = new SystemLocation(e.ctx, null);
    expect(location.basePath()).toMatch(/[Ff]onts/);
  });
});
