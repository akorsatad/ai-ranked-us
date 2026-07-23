---
name: Stale composite lib type builds
description: Workspace libs emit declarations to dist/ via composite tsc; typecheck errors about "missing" exports usually mean stale dist, not missing code
---

Rule: when api-server typecheck reports a `@workspace/db` or `@workspace/api-zod` export "does not exist" but the symbol is present in the lib's `src/`, rebuild the lib declarations (`npx tsc -b lib/db lib/api-zod`) before assuming real API drift.

**Why:** these libs use composite `emitDeclarationOnly` builds; consumers typecheck against `dist/*.d.ts`, which goes stale after merges or schema edits that didn't rebuild.

**How to apply:** any time typecheck fails only on workspace-lib imports, rebuild with `tsc -b` first, then re-run typecheck.
