import type { FontistContext } from '../context.js';
import { FormulaIndexRegistry } from '../index/formula/formulaFontIndex.js';
import { FormulaRepository } from '../formula/formulaRepository.js';
import { FormulasRepo } from './formulasRepo.js';
import { PrivateRepos } from './privateRepos.js';

/** Updates the main formulas repository and every private repository, then
 * rebuilds the formula indexes (also on failure — mirroring Ruby's ensure). */
export async function updateFormulas(ctx: FontistContext): Promise<void> {
  const repository = new FormulaRepository(ctx);
  const indexes = new FormulaIndexRegistry(ctx, repository);
  try {
    const repo = new FormulasRepo(ctx);
    await repo.update();
    const repos = new PrivateRepos(ctx);
    for (const name of await repos.list()) {
      await repos.update(name);
    }
  } finally {
    await indexes.rebuildAll();
  }
}
