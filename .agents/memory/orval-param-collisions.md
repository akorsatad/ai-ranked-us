---
name: Orval params name collisions
description: TS2308 collisions in lib/api-zod barrel when an operation has both path and query params
---

Operations with both path and query params can make Orval emit a zod value (path params, `<Op>Params` in `generated/api.ts`) and a TS type (query params, `<Op>Params` in `generated/types/`) with the same name, causing `TS2308: already exported a member` from the `export *` barrel.

**Why:** Orval names the path-param zod schema and the query-param type identically for some operations; the `lib/api-zod/src/index.ts` barrel re-exports both.

**How to apply:** Add the colliding name to the explicit `export { ... } from "./generated/api";` line in `lib/api-zod/src/index.ts` (existing pattern there). Note the server-side zod schema for query params is `<Op>QueryParams`, not `<Op>Params`.
