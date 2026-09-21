Status: DONE — implemented and verified this session.

# 1 — Package skeleton and tooling

Priority: 1 (blocking everything)

## Deliverable

- `package.json`: name `fontist`, ESM (`"type": "module"`), Node >= 20, bin `fontist` → `dist/cli.js`.
  Runtime deps: `yaml`, `commander`, `yauzl`, `tar`. Dev deps: `typescript`, `vitest`, `eslint`,
  `typescript-eslint`, `@types/node`, `@types/yauzl`, `prettier`.
- `tsconfig.json` (strict, NodeNext, `src` + `spec`) and `tsconfig.build.json` (src only → `dist`).
- `eslint.config.js` flat config, `vitest.config.ts`, `.gitignore` (dist, node_modules, coverage).
- `src/index.ts` public API exports: `Font`, `Formula`, `FormulaRepository`, `Manifest`,
  `InstallLocation`, `Config`, `errors`, version.

## Acceptance

- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all run clean.
