---
name: Dev DB schema drift
description: What to do when the API server fails with "column ... does not exist"
---
The dev Postgres DB can drift behind `lib/db/src/schema` (parallel tasks add columns without pushing).
**Why:** Hit a runtime `column "industry_id" of relation "survey_runs" does not exist` even though code/typecheck were fine.
**How to apply:** On any "column/relation does not exist" runtime error, run `pnpm run push` in `lib/db` (drizzle-kit push) before debugging code.
