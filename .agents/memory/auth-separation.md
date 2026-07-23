---
name: Admin auth is Clerk-only; magic-link session must not gate /admin routes
description: Two auth systems coexist — Clerk for admin, magic-link cookie for public users. They must never be mixed on the same route prefix.
---

The project has two separate auth systems:
- **Clerk** — admin access, gated by `requireAdmin` middleware inside `adminRouter`
- **Magic-link cookie** (`airank_session`) — public user sessions for the ad-hoc ranking flow

**Why:** Placing `requireSession` (magic-link) on `/admin/*` routes blocks valid Clerk admins who hold no `airank_session` cookie, breaking all admin API access.

**How to apply:** Never add `requireSession` or any magic-link middleware to `/admin/*` paths. Admin protection lives exclusively inside `adminRouter` via Clerk's `requireAdmin`. The `requireSession` middleware is only for rank/auth endpoints.
