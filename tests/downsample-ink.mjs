/**
 * How far thinning moves the drawn line on `/performance`.
 *
 * The measurement behind PLAN.md's decision to leave `downsample.ts` unwired,
 * committed because that decision rests on a number and a number nobody can
 * re-run is an assertion. Not a test — it renders a chart the site does not
 * ship, so it has nothing to guard. Run it with:
 *
 *     npx tsx tests/downsample-ink.mjs
 *
 * It compares the ink of the thinned render against the un-thinned one column
 * by column, *interpolating along each drawn segment* rather than sampling its
 * vertices. Sampling vertices is the wrong measure and says so loudly — it
 * reports 31px where the true figure is 12 — because a column whose vertex was
 * dropped is still painted by the segment passing through it.
 *
 * The rows where nothing is thinned are the control: they must read 0.000, and
 * they do. Anything else would mean the harness, not the thinning, was moving
 * the line.
 */
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { rebaseCovering } from '../pipeline/rebase.ts';
import { toAssetSeries, perfStartOptions } from '../src/lib/perf-shared.ts';
import { performanceSpec } from '../src/lib/specs/performance.ts';
import { renderResponsiveChart } from '../src/lib/plot-ssr.ts';
import { envelopeByPixel } from '../src/lib/downsample.ts';

/** What wiring it would have looked like: thinned per series, at the render width. */
const thinned = (points, width) => {
  const byAsset = new Map();
  for (const p of points) byAsset.set(p.asset, [...(byAsset.get(p.asset) ?? []), p]);
  return [...byAsset.values()].flatMap((s) =>
    envelopeByPixel(s, (p) => p.date.getTime(), (p) => p.index, width),
  );
};

/** Each drawn line's polyline, in document order, for one width variant. */
const polylines = (html, marker) => {
  const i = html.indexOf(marker);
  const { document } = parseHTML(`<div>${html.slice(i, html.indexOf('</span>', i))}</div>`);
  const out = [];
  for (const path of document.querySelectorAll('path[d]')) {
    const pts = [...(path.getAttribute('d') ?? '').matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
      (m) => [Number(m[1]), Number(m[2])],
    );
    if (pts.length >= 3) out.push(pts);
  }
  return out;
};

/** The y range a polyline paints in each pixel column. */
const ink = (line, width) => {
  const cols = new Map();
  const add = (c, y) => {
    const cur = cols.get(c);
    cols.set(c, cur ? [Math.min(cur[0], y), Math.max(cur[1], y)] : [y, y]);
  };
  for (let i = 1; i < line.length; i += 1) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    for (let c = Math.floor(Math.min(x0, x1)); c <= Math.ceil(Math.max(x0, x1)) && c <= width; c += 1) {
      const a = Math.max(Math.min(x0, x1), c);
      const b = Math.min(Math.max(x0, x1), c + 1);
      if (b < a) continue;
      const at = (x) => (x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
      add(c, at(a));
      add(c, at(b));
    }
  }
  return cols;
};

const file = JSON.parse(readFileSync(new URL('../data/benchmarks-history.json', import.meta.url), 'utf8'));
const assets = toAssetSeries(file);

console.log('preset  width   points        worst ink shift');
for (const option of perfStartOptions(assets, file.dailyDays)) {
  const rebased = rebaseCovering(assets, option.start);
  if (!rebased) continue;
  const points = rebased.series.flatMap((s) =>
    s.series.map((p) => ({ asset: s.asset, date: new Date(p.date), index: p.index })),
  );
  const ends = rebased.series.map((s) => {
    const last = s.series.at(-1);
    return { asset: s.asset, date: new Date(last.date), index: last.index };
  });
  const shown = rebased.series.map((s) => s.asset);
  for (const scale of ['log', 'linear']) {
    for (const [width, marker] of [
      [400, 'chart-at-narrow'],
      [760, 'chart-at-wide'],
    ]) {
      const full = polylines(
        renderResponsiveChart((w) => performanceSpec(points, ends, shown, scale, w)),
        marker,
      );
      const cut = polylines(
        renderResponsiveChart((w) => performanceSpec(thinned(points, w), ends, shown, scale, w)),
        marker,
      );
      let worst = 0;
      for (const [k, line] of full.entries()) {
        const a = ink(line, width);
        const b = ink(cut[k] ?? [], width);
        for (const [c, v] of a) {
          const o = b.get(c);
          if (!o) {
            worst = Infinity;
            continue;
          }
          worst = Math.max(worst, Math.abs(v[0] - o[0]), Math.abs(v[1] - o[1]));
        }
      }
      const kept = thinned(points, width).length;
      console.log(
        `${option.label.padEnd(4)}${option.selected ? '*' : ' '} ${String(width).padStart(4)}  ` +
          `${String(points.length).padStart(5)} → ${String(kept).padEnd(6)} ${scale.padEnd(7)} ` +
          `${worst.toFixed(3)}px`,
      );
    }
  }
}
