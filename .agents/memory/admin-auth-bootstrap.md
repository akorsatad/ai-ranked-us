---
name: Admin auth bootstrap
description: How admin access is decided for the protected /admin area
---
Admin access uses Replit-managed Clerk. Rule: the **first** authenticated user to hit an admin endpoint is written to the `admin_users` table and becomes the sole admin; everyone else gets 403.

**Why:** Task required "only you" access without a manual allowlist step; first-claim bootstrap avoids needing pre-provisioned credentials.

**How to apply:** All admin API routes go through the shared require-admin middleware on the admin router; `/admin/me` reports (and performs) the claim. Adding more admins means inserting rows into `admin_users`.
