import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['spec/**/*.spec.ts', 'spec/mirror/**/*_spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
