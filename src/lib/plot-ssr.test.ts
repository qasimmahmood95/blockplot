import { describe, expect, it } from 'vitest';
import { renderChartSvg } from './plot-ssr';
import { stripMarkAriaLabels } from './plot-a11y';
import { priceSpec } from './specs/price';

const POINTS = [
  { date: new Date('2024-01-01T00:00:00Z'), price: 40000 },
  { date: new Date('2024-01-02T00:00:00Z'), price: 42000 },
  { date: new Date('2024-01-03T00:00:00Z'), price: 41000 },
];

describe('renderChartSvg', () => {
  const svg = renderChartSvg(priceSpec(POINTS, 'USD', 720));

  it('returns a complete svg element', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('carries a viewBox, which is what lets the served chart scale', () => {
    expect(svg).toContain('viewBox="0 0 720');
  });

  it('leaves colours as custom properties rather than resolving them', () => {
    // The whole reason a build-time chart can be correct in both themes.
    expect(svg).toContain('var(--accent)');
    expect(svg).not.toMatch(/stroke="#[0-9a-f]{6}"/i);
  });

  it('emits no aria-label on a mark group', () => {
    // Plot labels every group and ARIA prohibits it without a role; the
    // container's own role="img" is the accessible name.
    expect(svg).not.toMatch(/<g[^>]*aria-label/);
  });

  it('plots the data rather than an empty frame', () => {
    expect(svg).toMatch(/<path[^>]*\sd="M/);
  });

  it('renders the same markup for the same spec', () => {
    expect(renderChartSvg(priceSpec(POINTS, 'USD', 720))).toBe(svg);
  });

  it('honours the requested width', () => {
    expect(renderChartSvg(priceSpec(POINTS, 'USD', 360))).toContain('viewBox="0 0 360');
  });
});

describe('stripMarkAriaLabels', () => {
  it('removes the attribute from every g that has one, and nothing else', () => {
    const removed: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('g[aria-label]');
        return [
          { removeAttribute: (n: string) => removed.push(`a:${n}`) },
          { removeAttribute: (n: string) => removed.push(`b:${n}`) },
        ];
      },
    };
    stripMarkAriaLabels(root);
    expect(removed).toEqual(['a:aria-label', 'b:aria-label']);
  });

  it('is a no-op when there are none', () => {
    expect(() => stripMarkAriaLabels({ querySelectorAll: () => [] })).not.toThrow();
  });
});
