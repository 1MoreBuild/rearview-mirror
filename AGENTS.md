# Repository Guidelines

- Repo: `rearview-mirror`
- Product scope: a Next.js timeline site tracking AI milestones plus Simon Willison's pelican benchmark artifacts.
- Prefer repo-root-relative paths in notes, reviews, and task handoffs (for example `lib/timeline.ts`, `scripts/extract-events.ts`).

## Project Structure & Module Organization

- `app/`: Next.js App Router pages and global styles.
- `components/`: UI components (`timeline/`, `site/`, `theme/`).
- `lib/`: timeline normalization, schema validation, and filtering utilities.
- `data/`:
  - `ai_timeline.json` (version `2`) is the core milestone dataset.
  - `pelican_timeline.json` (version `1`) is the pelican benchmark dataset.
  - `raw_rss.xml` is the latest feed snapshot used by automation.
- `scripts/`: extraction/evaluation/sync scripts for timeline data.
- `tests/`: Vitest tests for utilities and scripts.
- `public/pelican-svgs/`: benchmark image assets referenced by pelican entries.

## Build, Test, and Development Commands

- Install dependencies: `pnpm install`
- Start local dev server: `pnpm dev`
- Production build: `pnpm build`
- Lint: `pnpm lint`
- Run tests: `pnpm test`
- Data integrity guard: `pnpm check:data`
- TS/TSX file size guard: `pnpm check:loc` (default max: 500 lines)
- Full quality gate: `pnpm check`

## Content Pipeline Commands

- Extract timeline events from RSS:
  - `pnpm exec tsx scripts/extract-events.ts`
  - Common flags: `--file <xml>`, `--full`, `--limit <N>`, `--dry-run`
- Re-evaluate event significance:
  - `pnpm exec tsx scripts/evaluate-significance.ts`
  - Common flags: `--skip-validation`, `--dry-run`
- Sync pelican entries from tag page:
  - `pnpm exec tsx scripts/sync-pelican-from-tag.ts`
- Fetch/extract pelican SVGs:
  - `pnpm exec tsx scripts/fetch-pelican-svgs.ts fetch|extract|all [--limit N] [--dry-run] [--rescan]`

## Data & Validation Rules

- Keep schema-compatible fields only:
  - timeline: `date_precision`, `category`, `significance`, `sources`, etc.
  - pelican: `date`, `model`, `provider`, `svg_files`, optional `blog_url`, `notes`.
- Keep timeline events date-sorted (ascending) when editing `data/ai_timeline.json`.
- Preserve `version` markers in JSON source files unless an intentional schema migration is made.
- If a pelican entry points to an SVG file, ensure the file exists in `public/pelican-svgs/`.

## Environment & Secrets

- LLM scripts require `OPENROUTER_API_KEY`.
- `scripts/shared/openrouter-client.ts` auto-loads `.env.local`.
- Never commit secrets or `.env.local` values.

## Generated Artifacts

- `data/logs/` and `data/pelican-cache/` are generated pipeline outputs and are gitignored.
- Do not rely on generated logs as source-of-truth data; source-of-truth is the JSON in `data/`.

## Testing Guidelines

- Use Vitest (`tests/**/*.test.ts`).
- Add or update tests when changing:
  - timeline parsing/normalization logic in `lib/`
  - model detection / image matching logic in `scripts/sync-pelican-from-tag.ts`
- Prefer deterministic unit tests over network-dependent behavior.

## CI Workflows

- `.github/workflows/daily-extract.yml`: daily RSS extraction + pelican sync + optional deploy hook.
- `.github/workflows/weekly-eval.yml`: weekly significance re-evaluation.
- Keep local script behavior aligned with CI commands before changing pipeline logic.

## Commits & Handoff

- Prefer Conventional Commit prefixes: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `build`.
- Before handoff, run: `pnpm check` (and report remaining violations if any).

## Agent-Specific Notes

- `AGENTS.md` is the source-of-truth instruction file.
- Keep `claude.md` as a symlink to `AGENTS.md`:
  - `ln -sf AGENTS.md claude.md`
