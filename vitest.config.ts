import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pipeline/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    /**
     * Run in a non-UTC zone on purpose.
     *
     * Every date in `/data` is a UTC calendar day, and the code formats them
     * with `toISOString()` for that reason. Under UTC an accidental switch to
     * a local-time formatter is invisible: the assertion that `isoDay` gives
     * "the UTC calendar day, not the viewer's" passed either way, and so did
     * the mutation that broke it. GitHub's runners are UTC too, so the test
     * was inert exactly where it needed not to be.
     *
     * West of Greenwich is the case that exposes it — local time is the
     * *previous* calendar day for part of every UTC day.
     */
    env: { TZ: 'America/New_York' },
  },
});
