---
name: Stale lib declarations cause missing exports
description: After codegen, TypeScript declaration files in lib dist/ can be stale, making hooks appear missing to ai-rank typecheck.
---

After running codegen (`pnpm --filter @workspace/api-spec run codegen`), the `.d.ts` files in `lib/api-client-react/dist/` and `lib/api-zod/dist/` may lag behind the newly generated source. The ai-rank frontend typechecks against these declaration files.

**Why:** TypeScript project references only rebuild incrementally; a fresh codegen output isn't guaranteed to trigger a rebuild unless timestamps change correctly.

**How to apply:** After any codegen run that adds new endpoints, force-rebuild declarations before typechecking:
```
npx tsc --build lib/api-client-react/tsconfig.json lib/api-zod/tsconfig.json --force
```
