---
name: Bundled server needs SDK deps locally
description: esbuild-bundled api-server externalizes npm packages; they must be direct deps of api-server
---

Rule: any npm package imported (even transitively via a workspace lib) by api-server must also be listed in `artifacts/api-server/package.json` dependencies.

**Why:** esbuild bundles workspace lib source but externalizes bare npm imports; pnpm's strict node_modules layout means packages nested under `lib/*` are not resolvable from api-server at runtime → `ERR_MODULE_NOT_FOUND` on boot (hit with `@google/genai`).

**How to apply:** when adding a workspace lib dependency to api-server, copy its runtime npm deps into api-server's deps too, then `pnpm install`.
