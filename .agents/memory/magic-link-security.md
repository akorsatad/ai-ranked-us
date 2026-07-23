---
name: Magic-link URL must use trusted APP_BASE_URL, not request headers
description: Building magic-link URLs from x-forwarded-host or Host headers enables host-header injection / account takeover.
---

The magic-link email contains a verification URL. If this URL is built from `req.headers["x-forwarded-host"]` or `req.headers.host`, an attacker can forge the header to point the link at a domain they control, capture the token, and sign in as the victim.

**Why:** Request headers are attacker-controlled; only server-side environment config is trusted.

**How to apply:**
- Use `process.env.APP_BASE_URL` (set in production) as the origin for all magic-link URLs.
- Fall back to `http://localhost:5173` only in development (when `APP_BASE_URL` is unset).
- Token redemption should be atomic: use a single `UPDATE … WHERE usedAt IS NULL … RETURNING` instead of SELECT then UPDATE, to prevent replay races.

See `artifacts/api-server/src/routes/auth.ts` → `trustedBaseUrl()` and the `/auth/verify` handler.
