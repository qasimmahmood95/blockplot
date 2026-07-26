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
  interactive charts, the DCA simulator, and the live header ticker.
- The site builds purely from `/data` (pipeline-committed, zod-validated,
  versioned JSON). The only runtime fetch is the header ticker island
  (CoinGecko spot price).
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
