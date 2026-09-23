import type { FontFamily } from '../models/fontFamily.js';
import { ArgumentError, type BaseFormulaBuilder, type BuilderDeps } from './baseFormulaBuilder.js';
import { FormulaBuilderV4 } from './formulaBuilderV4.js';
import { FormulaBuilderV5 } from './formulaBuilderV5.js';
import type { FormulaHash } from './formulaHash.js';

/** Factory for the versioned formula builders (Ruby Google::FormulaBuilder). */
export const GoogleFormulaBuilder = {
  forVersion(version: number, deps: BuilderDeps): (family: FontFamily) => BaseFormulaBuilder {
    return (family: FontFamily) => {
      switch (version) {
        case 4:
          return new FormulaBuilderV4(family, deps);
        case 5:
          return new FormulaBuilderV5(family, deps);
        default:
          throw new ArgumentError(`Unknown formula version: ${version}`);
      }
    };
  },

  async build(family: FontFamily, version: number, deps: BuilderDeps): Promise<FormulaHash> {
    const builder = this.forVersion(version, deps)(family);
    return builder.build();
  },
};
