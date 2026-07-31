import { defineConfig } from 'vitest/config';

/**
 * A second project, over the *built* site rather than over source.
 *
 * Separate from `vitest.config.ts` because these tests need `dist/`, and the
 * main suite must not: CI runs `npm test` before `npm run build`, and a suite
 * that fails on a fresh clone for want of an artifact is a suite people learn
 * to re-run rather than read. `tests/` sits outside `src/` for the same reason —
 * the main config globs `src/**\/*.test.ts` and would otherwise pull these in.
 */
export default defineConfig({
  test: {
    include: ['tests/rendered/**/*.test.ts'],
    environment: 'node',
    // Same non-UTC zone as the main config, and for the reason recorded there.
    env: { TZ: 'America/New_York' },
  },
});
