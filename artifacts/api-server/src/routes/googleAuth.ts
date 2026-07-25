import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  ADMIN_SESSION_COOKIE,
  ensureAdminForIdentity,
  createAdminSession,
  deleteAdminSession,
} from "../middlewares/requireAdmin";
import { isGoogleAuthConfigured } from "../lib/authConfig";
import { logger } from "../lib/logger";

/**
 * Native Google OIDC sign-in for the admin console (no auth vendor).
 *
 * Flow: GET /auth/google/start sets a random state cookie and redirects to
 * Google's consent screen → Google redirects back to /auth/google/callback
 * with a one-time code → the code is exchanged server-side (client secret)
 * for an id_token → the verified email + stable subject id decide admin
 * access (invite claim / ADMIN_ALLOWED_EMAILS / bootstrap) → a DB-backed
 * session cookie is set and the browser returns to /admin.
 *
 * The redirect_uri is built from the trusted APP_BASE_URL env var (never
 * request headers) and must be registered in the Google Cloud Console.
 */

const STATE_COOKIE = "airank_gstate";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function appBaseUrl(): string | null {
  const base = process.env.APP_BASE_URL;
  return base ? base.replace(/\/$/, "") : null;
}

function redirectUri(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/api/auth/google/callback` : null;
}

interface GoogleIdClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
}

/**
 * Decodes the id_token payload. Signature verification is not required
 * here: the token arrives directly from Google's token endpoint over TLS
 * in response to our authenticated code exchange (OIDC core §3.1.3.7).
 * Claims are still validated defensively.
 */
function decodeIdToken(idToken: string): GoogleIdClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as GoogleIdClaims;
  } catch {
    return null;
  }
}

function validClaims(claims: GoogleIdClaims): boolean {
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com")
    return false;
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return false;
  if (!claims.sub) return false;
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now())
    return false;
  return true;
}

const router: IRouter = Router();

// GET /auth/google/start — kick off the OAuth flow.
router.get("/auth/google/start", (req, res): void => {
  if (!isGoogleAuthConfigured()) {
    res.status(503).json({
      message:
        "Google sign-in is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
    });
    return;
  }
  const uri = redirectUri();
  if (!uri) {
    res.status(503).json({
      message: "APP_BASE_URL must be set for Google sign-in.",
    });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: uri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// GET /auth/google/callback — exchange the code, decide admin, set session.
router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const base = appBaseUrl() ?? "";
  const fail = (reason: string): void => {
    res.redirect(`${base}/sign-in?error=${encodeURIComponent(reason)}`);
  };

  if (!isGoogleAuthConfigured()) {
    fail("not_configured");
    return;
  }

  const { code, state, error } = req.query as Record<string, string | undefined>;
  const stateCookie = (req.cookies as Record<string, string> | undefined)?.[
    STATE_COOKIE
  ];
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (error) {
    fail("google_denied");
    return;
  }
  if (!code || !state || !stateCookie || state !== stateCookie) {
    fail("invalid_state");
    return;
  }

  let idToken: string | undefined;
  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri()!,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      const body = await tokenResp.text().catch(() => "");
      logger.error(
        { status: tokenResp.status, body },
        "Google code exchange failed",
      );
      fail("exchange_failed");
      return;
    }
    const tokenJson = (await tokenResp.json()) as { id_token?: string };
    idToken = tokenJson.id_token;
  } catch (err) {
    logger.error({ err }, "Google code exchange crashed");
    fail("exchange_failed");
    return;
  }

  const claims = idToken ? decodeIdToken(idToken) : null;
  if (!claims || !validClaims(claims)) {
    fail("invalid_token");
    return;
  }
  const email =
    claims.email && claims.email_verified ? claims.email.toLowerCase() : null;

  const adminUser = await ensureAdminForIdentity(
    `google:${claims.sub}`,
    email,
  );
  if (!adminUser) {
    logger.warn({ email }, "Google sign-in refused — not an admin");
    fail("not_authorized");
    return;
  }

  const session = await createAdminSession(adminUser.id);
  res.cookie(ADMIN_SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    expires: session.expiresAt,
    path: "/",
  });
  logger.info({ adminUserId: adminUser.id }, "Admin signed in via Google");
  res.redirect(`${base}/admin`);
});

// DELETE /auth/admin/session — admin sign-out.
router.delete("/auth/admin/session", async (req, res): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[
    ADMIN_SESSION_COOKIE
  ];
  if (token) await deleteAdminSession(token);
  res.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  res.status(200).json({ message: "Signed out" });
});

export default router;
