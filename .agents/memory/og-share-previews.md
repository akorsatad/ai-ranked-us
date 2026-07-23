---
name: Per-page OG share previews
description: How industry pages get page-specific Open Graph tags/images despite static SPA serving
---
The ai-rank SPA is served statically with an SPA rewrite, so crawlers can't get per-page meta from it. Solution: the api-server artifact also claims the `/industry` path and serves the SPA's index.html with OG/Twitter meta injected (dev: fetches HTML from the Vite dev server on its localPort; prod: reads `artifacts/ai-rank/dist/public/index.html`). Dynamic 1200x630 PNG at `/api/og/industries/:id/image.png` rendered with `@resvg/resvg-js` (externalized in build.mjs, native module) + bundled Inter TTFs in `artifacts/api-server/assets/fonts`.
**Why:** static serve can't inject meta; routing the page path to the API server keeps the SPA build untouched.
**How to apply:** for any new shareable page type, add its path to the api-server service paths in artifact.toml and extend sharePage.ts; absolute URLs are derived from x-forwarded-host/proto, never hardcoded domains.
