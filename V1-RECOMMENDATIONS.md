# V1 Upgrade Plan — AI Ranked US

Findings from a full functionality scan (July 2026). Ordered by priority within
each area. "S/M/L" = rough effort (small / medium / large).

## P0 — Security (fix before or at production launch)

1. **Lock down the alerts endpoints (S).** `GET /api/alerts` and
   `GET /api/alerts/settings` are unauthenticated (`alerts.ts:37,102`) — the
   settings response exposes the admin's **email address** publicly, and the
   full alert feed is world-readable. Either `requireAdmin` both, or split a
   public "feed" from private settings. (The authz test file only covers the
   mutations.)
2. **Credentialed CORS reflection (S).** *Partially fixed during deploy prep:*
   `app.ts` now uses an allowlist when `CORS_ALLOWED_ORIGINS`/`APP_BASE_URL` is
   set. Remaining: remove the `origin: true` fallback once Replit dev has an
   explicit allowlist, so it can never reach production unset.
3. **Rate-limit the abuse-prone endpoints (S–M).**
   - `POST /api/auth/request-link`: no limit → mailer cost abuse + email
     enumeration. Add per-IP + per-email limits (e.g. 3/hour) with a neutral
     response.
   - `POST /api/rank/suggest-competitors`: unmetered AI calls for anonymous
     visitors.
   - The anonymous 1-free-run quota is cookie-based (`airank_visitor`) and
     trivially reset by clearing cookies; add an IP-based backstop.
4. **First-user-claims-admin land grab (S).** With Clerk sign-up open, whoever
   authenticates first owns `/admin` (`requireAdmin.ts:11-45`). Gate the claim
   with an `ADMIN_BOOTSTRAP_EMAIL` env allowlist (claim only succeeds when the
   Clerk email matches), or disable sign-up in Clerk and pre-provision.
5. **Encrypt stored provider API keys (M).** `provider_api_keys.api_key` is
   plaintext. Encrypt at rest (AES-GCM with a `SECRETS_ENCRYPTION_KEY` env) so a
   DB leak doesn't leak OpenAI/Anthropic/Gemini/OpenRouter keys.
6. **Baseline hardening headers (S).** No helmet/CSP/HSTS/X-Frame-Options.
   Add `helmet` with a CSP compatible with the SPA + Clerk.
7. **Session hygiene (M).** Magic-link sessions last 30 days with no cleanup:
   expired `sessions` and `magic_link_tokens` rows accumulate forever, and
   there's no "sign out everywhere" or admin-visible session list. Add a purge
   (cron piggyback) + a revoke-all endpoint.

## P1 — User management

1. ~~**Admin management UI (M).**~~ ✅ **DONE (July 2026):** `/admin/admins` —
   list admins, invite by email (claimed automatically at first admin sign-in),
   remove with self/last-admin guards. Remaining: audit trail of who added whom.
2. ~~**User directory for magic-link users (M).**~~ ✅ **DONE (July 2026):**
   `/admin/users` — search/paginate users with run counts, last activity,
   session counts; disable/enable (disabling revokes sessions and blocks
   magic-link sign-in without email enumeration). Remaining: per-user quota
   overrides, delete account.
3. **Profile self-service (S).** Name/email are captured once at first
   magic-link request and never editable; names are unvalidated free text.
   Add length caps + a minimal "your account" page (edit name, delete account).
4. **Unify the two auth systems' UX (S).** Users can be "signed in" via
   magic link while admins use Clerk — the header treats them differently and
   `/admin` link is visible to everyone. Hide the Admin nav item unless
   `/api/admin/me` says `isAdmin` (keep deep-link access).

## P1 — Admin improvements

1. **Serverless-safe survey runs (M–L).** The run lock is in-memory
   (`survey.ts:31`), the scheduler assumed a single long-lived process, and a
   full 196-query run exceeds one function invocation. Move the lock + progress
   into the DB (e.g. `FOR UPDATE SKIP LOCKED` on a `runs` row), make the
   executor chunk-native (process N queries per invocation), and let the cron
   endpoint drive it. This also fixes double-run races on multi-instance
   deploys and unblocks reliable "Run Survey Now" on Vercel.
2. **Batch the alert mark-read (S).** `alerts.ts:82-87` updates row-by-row in a
   loop; one `UPDATE ... WHERE id = ANY($1)` suffices.
3. **Data browser upgrades (M).** ✅ Partially done (July 2026): users,
   sessions (tokens never exposed), and ad_hoc_requests tables added with
   search/status filters. Remaining: alerts table, CSV export, per-column
   sorting.
4. **Audit log (M).** No record of admin actions (key changes, catalog edits,
   run controls). Add an `admin_audit` table written by the admin router, with
   a viewer page.
5. **Ops dashboard (S–M).** Surface provider spend vs. a configurable monthly
   budget cap (cost data already exists), failed-query rate per engine, and
   last-cron-run status so a silent scheduler failure is visible.
6. ~~**Fix ADMIN.md drift (S).**~~ ✅ **DONE (July 2026):** routes corrected,
   costs/model-results/queries/users/admins pages documented.

## P2 — Frontend usability

1. **Mobile navigation (S).** Primary nav is `hidden sm:flex` with no
   hamburger — on phones the Rank/Explore/Alerts links vanish entirely
   (`layout.tsx`). Add a sheet/drawer menu.
2. **Consistent email branding (S).** The magic-link email is dark-purple
   "AIRank" while the app is light/emerald "AI Ranked US" (`mailer.ts`), and
   the sender is Resend's sandbox address. Re-template + verified domain
   (`EMAIL_FROM` is already supported after deploy prep).
3. **Theme toggle (S).** A full `.dark` palette exists in `index.css` but
   nothing exposes it. `next-themes` is already a dependency — wire a toggle.
4. **Accessibility pass (S–M).** Icon-only buttons (e.g. remove-competitor X)
   need `aria-label`s; raw `<select>`/`<button>` in `home.tsx` should move to
   the shadcn equivalents for focus/keyboard consistency.
5. **Results-page polling UX (S).** `/results/:id` polls; add a clear
   "engines still responding (2/4 done)" progress readout and a terminal state
   when a provider fails, instead of indefinite spinners.
6. **SEO/OG for the home page (S).** `/industry/:id` has dynamic OG images —
   the landing page should get a static-but-branded card and meta description
   tuned to "How do AI models rank your brand?".

## P2 — Platform / operations

1. **Versioned migrations (M).** Schema changes go out via `drizzle-kit push`
   with no history — risky against production data. Adopt `drizzle-kit
   generate` + committed migrations, run on deploy.
2. **Error tracking (S).** Add Sentry (server + SPA) before real users arrive.
3. **Staging data separation (S).** Keep preview/dev pointing at a Neon branch,
   never at the production database (documented in DEPLOYMENT.md).

## Suggested V1 scope (2–3 focused days)

Day 1: P0 items 1–4 + helmet (all small).
Day 2: serverless-safe runs (admin P1.1) + admin/users + admin/admins pages.
Day 3: mobile nav, email re-brand, theme toggle, migrations switch, Sentry.
