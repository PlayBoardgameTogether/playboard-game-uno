import { URL, fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@boardgame/game-sdk': fileURLToPath(
        new URL('./packages/game-sdk/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/release.test.ts'],
  },
});
