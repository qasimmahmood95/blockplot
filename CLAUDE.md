# CLAUDE.md

Standing rules for AI-assisted development in this repo, in every environment
(local and cloud). PLAN.md holds the milestone plan. Both files are permanent
and never gitignored.

## Commit authorship (strict)

- Every development commit is authored solely by the repo owner. Before any
  commit, in every clone:

  ```
  git config user.name "qasimmahmood95"
  git config user.email "95350675+qasimmahmood95@users.noreply.github.com"
  ```

  The account blocks pushes that expose a real email address.
- Never add `Co-authored-by:` trailers or "Generated with" lines to any
  commit message.
- No commit signing anywhere; history stays uniformly unsigned
  (`git config commit.gpgsign false`).
- Data-refresh commits made by `.github/workflows/pipeline.yml` are authored
  by `github-actions[bot]` and only by it. Never hand-author commits as the
  bot; never commit pipeline output as the owner (the one exception was the
  seed data in the scaffold commit). Automation stays clearly separated from
  human-directed work.

## Workflow

- Conventional commit messages throughout.
- One PR per milestone (M1 onward, per PLAN.md), in order. PR descriptions follow
  `.github/pull_request_template.md`: scope, approach, and what the tests pin
  down. Human review happens at PR boundaries.
- Process artifacts are committed, not hidden.

## Architecture invariants

- Astro + TypeScript strict; static output only. Client islands only for
  interactive charts, the DCA simulator, the live header ticker, the
  network page's fee tiers (added in M8: fees move on a ~10-minute
  timescale, so a 6-hourly committed value would be stale on arrival; the
  committed snapshot renders and the island upgrades it, falling back on
  failure — the same pattern as the ticker), and the holdings panel and its
  header tile (added in M12: the input is the reader's own and is held in
  `localStorage`, so it cannot be baked at build time — this is the one
  island class whose state is personal rather than derived from `/data`).
- Reader-entered data stays in the browser. It must never appear in a URL,
  query string, page title, form action, or any request — a "share this"
  feature is a violation, not an exception — and is never committed. It is
  written to `localStorage` and read back by the page, nothing more. Any
  feature that would move it requires amending this rule in the same PR.
- Adding or removing a runtime fetch requires re-checking the holdings page's
  privacy note against the built output — by driving `dist/` and recording the
  requests, not by reading the diff. That note enumerates the site's requests
  and which pages make them, so a change here silently makes it false, which is
  worse than having no note because a reader can check it. Errors that
  understate exposure are the ones that matter.
- The site builds purely from `/data` (pipeline-committed, zod-validated,
  versioned JSON). Exactly two runtime fetches are sanctioned, both of which
  render a committed value first and upgrade it on success: the header ticker
  (CoinGecko spot price) and the network page's fee tiers (mempool.space).
  Adding a third requires amending this list in the same PR.
- Every metric calculation is a pure function under `pipeline/` with unit
  tests against fixed fixtures asserting exact expected outputs. No metric
  maths in UI components.
- The deploy step stays isolated in `.github/workflows/deploy.yml` so a host
  swap is a one-file change.

## Design constraints

- Data-dense but hierarchical: one primary chart per view, compact stat
  grids, clear section separation.
- Characterful heading typeface (Bricolage Grotesque) with tabular mono
  numerals (IBM Plex Mono); burnt-orange accent on a warm neutral base; light
  and dark mode.
- Decoration only when specific to this app (ticker, gridline texture, number
  tweens) — never purple/blue gradients, glassmorphism, emoji, or hero
  sections.
- No marketing copy; text is labels, figures, methodology notes.
