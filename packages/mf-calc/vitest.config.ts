import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@alot/mf-calc': new URL('./src/index.ts', import.meta.url).pathname } },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
