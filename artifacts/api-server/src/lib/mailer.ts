import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const FROM_ADDRESS = "AI Rank <onboarding@resend.dev>";

export async function sendMagicLinkEmail(
  to: string,
  firstName: string,
  magicLink: string,
): Promise<void> {
  const connectors = new ReplitConnectors();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#0a0a0f;color:#e2e8f0;">
  <div style="margin-bottom:32px;">
    <span style="font-weight:800;font-size:22px;letter-spacing:-0.5px;color:#e2e8f0;">AI<span style="color:#7c3aed;">Rank</span></span>
  </div>
  <h1 style="font-size:24px;font-weight:700;margin:0 0 12px;color:#f1f5f9;">Sign in to AI&nbsp;Rank</h1>
  <p style="color:#94a3b8;margin:0 0 28px;font-size:15px;line-height:1.6;">Hi ${firstName}, click the button below to sign in. This link expires in 15&nbsp;minutes.</p>
  <a href="${magicLink}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:15px;">Sign in to AI Rank</a>
  <p style="color:#64748b;margin:28px 0 0;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
</body>
</html>
  `.trim();

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject: "Your AI Rank sign-in link",
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text }, "Resend email failed");
    throw new Error(`Failed to send email: ${response.status}`);
  }

  logger.info({ to }, "Magic link email sent");
}
