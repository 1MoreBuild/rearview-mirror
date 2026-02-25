# Rearview Mirror

Rearview Mirror is a Next.js site that tracks AI model milestones from the ChatGPT 3.5 era onward.

## Stack

- Next.js (App Router)
- TypeScript
- Vercel-ready deployment
- Structured JSON content + Zod validation
- Vitest for utility-level tests

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
pnpm dev
pnpm lint
pnpm test
pnpm build
```

## Content model

Model timeline source data is stored in:

- `data/ai_model_timeline_2025-01_to_2026-02-24_en.json`

The app normalizes this source into internal timeline events at runtime.

Schema and filtering utilities:

- `lib/timeline-schema.ts`
- `lib/timeline.ts`
- `lib/timeline-utils.ts`

## Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import the project in [Vercel](https://vercel.com/new).
3. Use default Next.js build settings.

No extra environment variables are required for v1.
