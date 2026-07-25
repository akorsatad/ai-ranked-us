# Deploying AI Ranked US to Vercel

The app deploys as a **static SPA + one Express serverless function + Vercel Cron**:

- `artifacts/ai-rank` → static files (`artifacts/ai-rank/dist/public`)
- `artifacts/api-server` → esbuild-bundled into `api/_server/vercel.mjs`, exposed
  through the `api/index.mjs` function. `vercel.json` rewrites `/api/*` and
  `/industry/:id` (OG share pages) to it; everything else falls back to the SPA.
- The in-process daily scheduler is replaced by a Vercel Cron entry hitting
  `GET /api/internal/cron/daily-survey` (protected by `CRON_SECRET`) at 06:00 UTC.

The Replit setup (`.replit`, `build.mjs`, `src/index.ts`) is untouched and still works.

## One-time setup

1. **Login + link** (interactive, requires browser approval):

   ```sh
   vercel login
   vercel link        # create/link the project, root = repo root
   ```

2. **Database** — create a Postgres DB (Neon via Vercel Marketplace works well:
   Vercel dashboard → Storage → Create → Neon). Use the **pooled** connection
   string. Push the schema from your machine:

   ```sh
   DATABASE_URL="postgres://..." pnpm --filter @workspace/db run push
   ```

   Use a **separate database (or Neon branch) per environment** — one for
   Preview (dev), one for Production.

3. **Environment variables** — see `.env.example` for the full annotated list.
   Set them per environment (`preview` = dev, `production`):

   ```sh
   vercel env add DATABASE_URL preview
   vercel env add APP_BASE_URL preview          # the preview URL
   vercel env add RESEND_API_KEY preview
   vercel env add CRON_SECRET preview           # openssl rand -hex 32
   # Admin auth (native Google OIDC) — optional at first; admin shows a
   # setup notice without it. Create a Web-application OAuth client at
   # https://console.cloud.google.com/apis/credentials with redirect URI
   # <APP_BASE_URL>/api/auth/google/callback
   vercel env add GOOGLE_CLIENT_ID preview
   vercel env add GOOGLE_CLIENT_SECRET preview
   vercel env add ADMIN_ALLOWED_EMAILS preview  # e.g. jake@datainc.ai
   # repeat with `production` for the prod values
   ```

   AI provider keys: easiest is to configure them in **/admin/api-keys** after
   deploying (stored keys call providers' public APIs directly). Env-based keys
   also work but require the matching `*_BASE_URL` too (see `.env.example`).

## Deploy

```sh
vercel            # preview (dev) deployment
vercel --prod     # production
```

## What to verify after the first deploy

- `GET /api/healthz` → ok
- `/` renders; ad-hoc "Rank your brand" works once provider keys are set
- `/industry/:id` full-page load returns HTML with injected OG tags, and
  `/api/og/industries/:id/image.png` renders (exercises the bundled fonts and
  the native `@resvg/resvg-js` module — both are pulled in via
  `functions.includeFiles` and the root-level `@resvg/resvg-js` dependency)
- Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<url>/api/internal/cron/daily-survey`

## Platform constraints to know about

- **Survey run duration.** A full run is ~196 AI queries at concurrency 4 —
  typically longer than one function invocation (`maxDuration: 300`). The cron
  endpoint is **resumable**: each invocation continues where the last one
  stopped (already-answered queries are skipped). On the Hobby plan the cron
  fires once/day, so a long run may finish only after the next invocation or a
  manual `curl` of the cron endpoint. On Pro you can add more cron entries
  (e.g. every 10 minutes from 06:00–08:00 UTC) for same-morning completion.
- **Manual runs from the admin UI** start the run inside a normal API
  invocation; processing stops when the function is frozen/killed after ~300s.
  The cron endpoint (or the next cron firing) picks up the remainder.
- **Admin access:** emails in `ADMIN_ALLOWED_EMAILS` get admin automatically
  on first Google sign-in; further admins are invited from `/admin/admins`.
  Without the env var, the first person to sign in claims admin — set it.
- **Multiple warm instances** can, in rare races, both process a run (the app's
  run lock is in-memory). Harmless for data (responses are per-query rows) but
  worth fixing with a DB-level lock for V1.

## Production checklist

- [ ] Separate `DATABASE_URL` (prod DB / Neon branch), schema pushed
- [ ] `APP_BASE_URL=https://<your-domain>` (also drives CORS allowlist)
- [ ] `CRON_SECRET` set (distinct from preview)
- [ ] Google OAuth client: production redirect URI added
      (`https://<domain>/api/auth/google/callback`), `GOOGLE_CLIENT_ID` /
      `GOOGLE_CLIENT_SECRET` / `ADMIN_ALLOWED_EMAILS` set
- [ ] Resend: verified sending domain + `EMAIL_FROM` (the default
      `onboarding@resend.dev` sandbox sender only delivers to your own inbox)
- [ ] Provider API keys entered in `/admin/api-keys` (test buttons pass)
- [ ] Sign in at `/admin` with an allowlisted Google account
