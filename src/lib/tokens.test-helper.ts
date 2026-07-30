/**
 * The colour tokens, read from `tokens.css` itself.
 *
 * Two test files carried a hand-copied table of these values with a comment
 * saying the duplication existed so "a change there cannot quietly drop a series
 * below the floor". It could not: nothing in the repo read the stylesheet, so
 * editing `--accent` left every contrast assertion green. The table happened to
 * match, which is the worst case — a guarantee that looks kept.
 *
 * Parsed rather than imported because the file is plain CSS with a
 * `prefers-color-scheme` block and a `[data-theme]` override, and the tests want
 * one resolved value per token per theme.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Theme = 'light' | 'dark';

const CSS_PATH = fileURLToPath(new URL('../styles/tokens.css', import.meta.url));

/**
 * Every `--token: #hex` declaration, resolved per theme.
 *
 * The light values are the `:root` block; the dark ones are whatever the dark
 * overrides last set, which is how the cascade resolves them in a browser. Only
 * hex colours are collected — the file also holds fonts, radii and shadows, and
 * a contrast test has nothing to say about those.
 */
export function readTokens(): Record<string, Record<Theme, string>> {
  const css = readFileSync(CSS_PATH, 'utf8');
  const tokens: Record<string, Record<Theme, string>> = {};
  // Split on the first dark-mode selector: everything before it is the light
  // theme, everything after is a dark override.
  const darkAt = css.search(/@media \(prefers-color-scheme: dark\)|\[data-theme='?"?dark/);
  const sections: [Theme, string][] = [
    ['light', darkAt === -1 ? css : css.slice(0, darkAt)],
    ['dark', darkAt === -1 ? '' : css.slice(darkAt)],
  ];
  for (const [theme, section] of sections) {
    for (const [, name, hex] of section.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      const key = name as string;
      const light = tokens[key]?.light ?? (hex as string);
      tokens[key] = { light: theme === 'light' ? (hex as string) : light, dark: hex as string };
    }
  }
  // A token declared only in the light block keeps that value in dark, which is
  // what the cascade does when there is no override.
  for (const value of Object.values(tokens)) value.dark ||= value.light;
  return tokens;
}

/** Relative luminance, per WCAG. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** Contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** Resolve a `var(--token)` string against a theme, or '' if it is not one. */
export function resolveToken(
  value: string,
  theme: Theme,
  tokens: Record<string, Record<Theme, string>>,
): string {
  const name = /var\((--[a-z0-9-]+)\)/.exec(value)?.[1];
  return tokens[name ?? '']?.[theme] ?? '';
}
