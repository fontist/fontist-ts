import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormulaRepository } from '../src/formula/formulaRepository.js';
import {
  DefaultFamilyFontIndex,
  FormulaFilenameIndex,
  FormulaIndexRegistry,
  PreferredFamilyFontIndex,
} from '../src/index/formula/formulaFontIndex.js';
import { FontistIndex } from '../src/index/installed/collectionIndexes.js';
import { cleanup, makeTtf, testEnv, writeFormula, type TestEnv } from './helpers/index.js';

async function envWithFormulas(): Promise<TestEnv> {
  const env = await testEnv();
  await writeFormula(env, 'andale', {
    name: 'Andale',
    fonts: [
      {
        name: 'Andale Mono',
        styles: [
          { family_name: 'Andale Mono', type: 'Regular', font: 'AndaleMo.TTF', full_name: 'Andale Mono' },
        ],
      },
    ],
    resources: { 'andale.zip': { urls: ['https://example.com/a.zip'] } },
  });
  await writeFormula(env, 'macos/inaimathi', {
    name: 'InaiMathi',
    fonts: [
      {
        name: 'InaiMathi',
        styles: [
          {
            family_name: 'InaiMathi',
            type: 'Bold',
            font: 'InaiMathi-MN.ttc',
            preferred_family_name: 'InaiMathi Preferred',
          },
        ],
      },
    ],
    font_collections: [
      {
        filename: 'InaiMathi-MN.ttc',
        fonts: [
          {
            name: 'InaiMathi',
            styles: [{ family_name: 'InaiMathi', type: 'Bold', font: 'InaiMathi-MN.ttc' }],
          },
        ],
      },
    ],
  });
  return env;
}

describe('FormulaRepository', () => {
  it('loads all formulas, computes keys, and defaults names', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const formulas = await repo.all();
      expect(formulas).toHaveLength(2);
      const keys = (await repo.allKeys()).sort();
      expect(keys).toEqual(['andale', 'macos/inaimathi']);
      const inaimathi = await repo.findByKey('macos/inaimathi');
      expect(inaimathi?.name).toBe('InaiMathi');
      expect(inaimathi?.key()).toBe('macos/inaimathi');
      const untitled = await repo.findByKey('andale');
      expect(untitled?.name).toBe('Andale');
    } finally {
      await cleanup(env);
    }
  });

  it('finds by name with normalization and by key-or-name', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      expect((await repo.findByName('andale'))?.key()).toBe('andale');
      expect((await repo.findByKeyOrName('andale'))?.key()).toBe('andale');
      expect(await repo.findByName('missing-formula')).toBeNull();
    } finally {
      await cleanup(env);
    }
  });

  it('memoizes all() per instance until invalidated', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const first = await repo.all();
      const second = await repo.all();
      expect(second).toBe(first); // same memoized array
      await writeFormula(env, 'late_arrival', {
        name: 'Late',
        fonts: [{ name: 'Late', styles: [{ family_name: 'Late', type: 'Regular', font: 'Late.ttf' }] }],
        resources: { 'l.zip': { urls: ['https://example.com/l.zip'] } },
      });
      expect(await repo.all()).toHaveLength(2); // still memoized
      repo.invalidate();
      const refreshed = await repo.all();
      expect(refreshed).toHaveLength(3);
      expect((await repo.allKeys()).sort()).toContain('late_arrival');
    } finally {
      await cleanup(env);
    }
  });

  it('warns and skips unparseable formulas', async () => {
    const env = await envWithFormulas();
    try {
      await fsp.writeFile(path.join(env.ctx.paths.formulasPath(), 'broken.yml'), '{ not: [valid');
      const repo = new FormulaRepository(env.ctx);
      const formulas = await repo.all();
      expect(formulas).toHaveLength(2);
      expect(env.ui.lines.join('\n')).toContain('WARN: Could not load formula');
    } finally {
      await cleanup(env);
    }
  });
});

describe('FormulaFontIndex', () => {
  it('indexes by default family and looks up case-insensitively', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const index = new DefaultFamilyFontIndex(env.ctx, repo);
      await index.rebuild();
      const byFamily = await index.loadFormulas('ANDALE MONO');
      expect(byFamily).toHaveLength(1);
      expect(byFamily[0]!.key()).toBe('andale');
      // Collection fonts: family_name InaiMathi (twice via fonts + collections dedupe paths)
      const byCollection = await index.loadFormulas('inaimathi');
      expect(byCollection.map((f) => f.key())).toContain('macos/inaimathi');
      // persisted to the default family index path
      const persisted = await fsp.readFile(env.ctx.paths.formulaDefaultFamilyIndexPath(), 'utf8');
      expect(persisted).toContain('andale');
    } finally {
      await cleanup(env);
    }
  });

  it('indexes by preferred family in its own index', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const index = new PreferredFamilyFontIndex(env.ctx, repo);
      await index.rebuild();
      const found = await index.loadFormulas('inaiMathi Preferred');
      expect(found.map((f) => f.key())).toEqual(['macos/inaimathi']);
      expect(await index.loadFormulas('andale mono')).toHaveLength(1);
    } finally {
      await cleanup(env);
    }
  });

  it('indexes installed filenames exactly', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const index = new FormulaFilenameIndex(env.ctx, repo);
      await index.rebuild();
      const found = await index.loadFormulasByFile('AndaleMo.TTF');
      expect(found.map((f) => f.key())).toEqual(['andale']);
      expect(await index.loadFormulasByFile('andalemo.ttf')).toHaveLength(0);
    } finally {
      await cleanup(env);
    }
  });

  it('rebuilds all indexes via the registry', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const registry = new FormulaIndexRegistry(env.ctx, repo);
      await registry.rebuildAll();
      for (const indexFile of [
        env.ctx.paths.formulaDefaultFamilyIndexPath(),
        env.ctx.paths.formulaPreferredFamilyIndexPath(),
        env.ctx.paths.formulaFilenameIndexPath(),
      ]) {
        await expect(fsp.access(indexFile)).resolves.toBeUndefined();
      }
    } finally {
      await cleanup(env);
    }
  });

  it('auto-rebuilds when the index file is missing', async () => {
    const env = await envWithFormulas();
    try {
      const repo = new FormulaRepository(env.ctx);
      const index = new DefaultFamilyFontIndex(env.ctx, repo);
      const found = await index.loadFormulas('andale mono');
      expect(found).toHaveLength(1);
    } finally {
      await cleanup(env);
    }
  });
});

describe('installed-font indexes', () => {
  it('builds an index from fixture fonts and finds by family', async () => {
    const env = await testEnv();
    try {
      const fontsDir = env.ctx.paths.fontsPath();
      await fsp.mkdir(fontsDir, { recursive: true });
      await fsp.writeFile(path.join(fontsDir, 'Inter-Regular.ttf'), makeTtf({ family: 'Inter', subfamily: 'Regular', fullName: 'Inter Regular' }));
      // Fonts missing required name records are not indexable (Ruby indexability gate)
      await fsp.writeFile(path.join(fontsDir, 'Inter-Bold.ttf'), makeTtf({ family: 'Inter', subfamily: 'Bold', fullName: 'Inter Bold' }));
      // Fonts missing required name records are not indexable (Ruby indexability gate)

      const index = new FontistIndex(env.ctx);
      const found = await index.find('inter');
      expect(found).toHaveLength(2);
      const bold = (await index.find('inter', 'bold')) ?? [];
      expect(bold).toHaveLength(1);
      expect(bold[0]!.subfamily).toBe('Bold');
      expect(await index.findPath('Inter', 'Regular')).toContain('Inter-Regular.ttf');
      // Ruby find matches family names only; full names are stored, never matched
      expect(await index.findPath('Inter Regular')).toBeNull();
    } finally {
      await cleanup(env);
    }
  });

  it('persists the index and reuses entries when mtimes are unchanged', async () => {
    const env = await testEnv();
    try {
      const fontsDir = env.ctx.paths.fontsPath();
      await fsp.mkdir(fontsDir, { recursive: true });
      const fontPath = path.join(fontsDir, 'One.ttf');
      await fsp.writeFile(fontPath, makeTtf({ family: 'One', subfamily: 'Regular', fullName: 'One Regular' }));

      const first = new FontistIndex(env.ctx);
      const before = await first.find('one');
      expect(before).toHaveLength(1);
      const indexPath = env.ctx.paths.fontistIndexPath();
      const snapshot = await fsp.readFile(indexPath, 'utf8');

      // A fresh instance should reuse the persisted index (mtime untouched).
      const second = new FontistIndex(env.ctx);
      expect(await second.find('one')).toHaveLength(1);
      expect(await fsp.readFile(indexPath, 'utf8')).toBe(snapshot);

      // Forced rebuild within the adoption window adopts the on-disk index
      // (Ruby rebuild_with_lock), leaving the file byte-identical.
      const third = new FontistIndex(env.ctx);
      await third.rebuild({ forced: true });
      expect(await fsp.readFile(indexPath, 'utf8')).toBe(snapshot);

      // A stale last_scan_time defeats adoption -> real rescan rewrites.
      const yamlMod = await import('yaml');
      const stale = yamlMod.parse(snapshot) as { last_scan_time: number };
      stale.last_scan_time = 0;
      await fsp.writeFile(indexPath, yamlMod.stringify(stale, { lineWidth: 1000 }));
      const fourth = new FontistIndex(env.ctx);
      await fourth.rebuild({ forced: true });
      expect(await fsp.readFile(indexPath, 'utf8')).not.toBe(snapshot);
    } finally {
      await cleanup(env);
    }
  });

  it('updates incrementally on addFont/removeFont', async () => {
    const env = await testEnv();
    try {
      const fontsDir = env.ctx.paths.fontsPath();
      await fsp.mkdir(fontsDir, { recursive: true });
      const fontPath = path.join(fontsDir, 'Two.ttf');
      await fsp.writeFile(fontPath, makeTtf({ family: 'Two', subfamily: 'Regular', fullName: 'Two Regular' }));
      const index = new FontistIndex(env.ctx);
      expect(await index.find('two')).toHaveLength(1);

      const extra = path.join(fontsDir, 'Three.ttf');
      await fsp.writeFile(extra, makeTtf({ family: 'Three', subfamily: 'Regular', fullName: 'Three Regular' }));
      await index.addFont(extra);
      expect(await index.find('three')).toHaveLength(1);

      await fsp.rm(extra, { force: true });
      await index.removeFont(extra);
      expect(await index.find('three')).toBeNull();
      expect(await index.find('two')).toHaveLength(1);
    } finally {
      await cleanup(env);
    }
  });

  it('skips corrupt font files during rebuild', async () => {
    const env = await testEnv();
    try {
      const fontsDir = env.ctx.paths.fontsPath();
      await fsp.mkdir(fontsDir, { recursive: true });
      await fsp.writeFile(path.join(fontsDir, 'Good.ttf'), makeTtf({ family: 'Good', subfamily: 'Regular', fullName: 'Good Regular' }));
      await fsp.writeFile(path.join(fontsDir, 'Corrupt.ttf'), Buffer.from('garbage garbage garbage'));
      // Parses but lacks required name records -> not indexable
      await fsp.writeFile(path.join(fontsDir, 'Nameless.ttf'), makeTtf({ family: 'Nameless' }));
      const index = new FontistIndex(env.ctx);
      const found = await index.find('good');
      expect(found).toHaveLength(1);
      expect(await index.find('corrupt')).toBeNull();
      expect(await index.find('nameless')).toBeNull();
    } finally {
      await cleanup(env);
    }
  });
});
