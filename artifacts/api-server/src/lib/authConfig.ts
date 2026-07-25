/**
 * Native Google OIDC admin auth. Optional: a deployment without Google
 * OAuth credentials still serves the public app; admin endpoints report
 * 503 until GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.
 */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}
