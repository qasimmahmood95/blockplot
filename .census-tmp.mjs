// Census v2: for every numeric token in rendered prose, decide whether it is a
// PROJECTION (came from /data via interpolation) or a LITERAL (typed into src/).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';

const ROOT = '/home/user/blockplot';
const DIST = join(ROOT, 'dist');

function files(dir, ext) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

const srcText = files(join(ROOT, 'src'), ['.astro', '.ts'])
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const PROSE_SEL = 'p.method-note, p, figcaption, caption, li, h2, h3';
const NUM = /(?<![\w.])[−+-]?[£$]?\d[\d,]*(?:\.\d+)?/g;

const rows = [];
for (const file of files(DIST, ['.html']).sort()) {
  const route = file.replace(DIST, '').replace(/\/index\.html$/, '/') || '/';
  const { document } = parseHTML(readFileSync(file, 'utf8'));
  for (const el of document.querySelectorAll(PROSE_SEL)) {
    if (el.querySelector(PROSE_SEL)) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const m of text.matchAll(NUM)) {
      const digits = m[0].replace(/[^\d.]/g, '');
      rows.push({ route, num: m[0], digits, text });
    }
  }
}

const literal = new Map();
const projected = new Map();
for (const r of rows) {
  const bucket = srcText.includes(r.digits) ? literal : projected;
  if (!bucket.has(r.digits)) bucket.set(r.digits, new Set());
  bucket.get(r.digits).add(`${r.route}  <<${r.text.slice(0, 120)}>>`);
}

console.log('prose numeric tokens:', rows.length);
console.log('distinct digit-strings appearing verbatim in src/  (LITERAL candidates):', literal.size);
console.log('distinct digit-strings NOT in src/                 (PROJECTIONS):', projected.size);

console.log('\n================ LITERAL CANDIDATES ================');
for (const [d, ctx] of [...literal].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`\n${d}   (${ctx.size} contexts)`);
  for (const c of [...ctx].slice(0, 2)) console.log('    ' + c);
}
