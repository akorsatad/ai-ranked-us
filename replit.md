# AI Rank

Daily tracker of how major AI engines (GPT, Claude, Gemini, Grok) perceive major US brands versus their industry peers across 7 sentiment metrics, with rankings and 13-week trend lines.

## Run & Operate

- Workflows: `artifacts/api-server: API Server` and `artifacts/ai-rank: web` (dashboard at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, plus `AI_INTEGRATIONS_{OPENAI,ANTHROPIC,GEMINI,OPENROUTER}_{BASE_URL,API_KEY}` (Replit AI Integrations, auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; Frontend: React + Vite + Tailwind + Recharts
- DB: PostgreSQL + Drizzle ORM; Validation: Zod (`zod/v4`)
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)
- AI engines via Replit AI Integrations libs: `lib/integrations-{openai-ai-server,anthropic-ai,gemini-ai,openrouter-ai}`

## Where things live

- DB schema: `lib/db/src/schema/aiRank.ts` (industries, brands, engines, survey_runs, survey_responses)
- API contract: `lib/api-spec/openapi.yaml` → generated into `lib/api-zod` and `lib/api-client-react`
- Survey engine: `artifacts/api-server/src/lib/` — `metrics.ts` (7 metric defs), `survey.ts` (run orchestration + prompts + parsing), `engineClients.ts` (per-provider one-shot calls), `scheduler.ts` (daily 06:00 UTC), `seed.ts` (catalog seed at boot), `aggregate.ts` (cross-engine averaging)
- Routes: `artifacts/api-server/src/routes/{catalog,overview,industries,runs}.ts`
- Frontend pages: `artifacts/ai-rank/src/pages/` (dashboard, industry detail, runs history)

## Architecture decisions

- Every engine survey query is a fresh, isolated one-shot request (no shared context) — 4 engines × 7 industries × 7 metrics = 196 queries per run
- Engine responses (rankings + 13-week trend estimates) stored raw-ish as JSONB per (run, engine, industry, metric); aggregation (average + re-rank) happens at read time
- AI clients are imported lazily so the server boots even if an integration is unprovisioned; failures are recorded per query and runs finish as `partial`
- Metrics are code-defined constants (`metrics.ts`), not DB rows; `negative_sentiment` is inverted (higher = worse; leader = lowest score)
- Schema is country-ready (`industries.country`, default 'US'); UI is US-only for now
- Daily scheduler is in-process: checks every 10 min, runs once per UTC day after 06:00 UTC

## Product

- Dashboard: run stats, industry leaders per metric, manual "Run Survey Now"
- Industry detail: metric tabs, consensus ranking with rationales, per-engine breakdowns, 13-week trend chart
- Runs history: statuses, success/failure counts, manual trigger
- Admin area (`/admin`, unauthenticated for now — see task for admin login): run control, industry/brand/engine management (enable/disable excludes from surveys and public catalog), per-provider API keys (stored keys in `app_settings` take precedence over Replit AI Integration env keys and hit provider public endpoints), read-only data browser with per-table filters

## User preferences

_None recorded yet._

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, rerun codegen; `lib/api-zod/src/index.ts` re-exports two param schemas explicitly to avoid a TS2308 name collision — keep that pattern
- AI SDK packages (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `p-limit`, `p-retry`) must stay in `artifacts/api-server/package.json` deps — pnpm's strict layout otherwise hides them from the esbuild-bundled server at runtime

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
