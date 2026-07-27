import { sendViaResend, emailFrom } from "./emailTransport";
import { logger } from "./logger";

// Brand tokens mirrored from the SPA design system (teal / paper / ink).
const TEAL = "#0EA88E";
const INK = "#0B0F19";
const PAPER = "#FCFCFB";
const SURFACE = "#F4F6F5";
const LINE = "#E6E9E8";
const BODY = "#4B5563";
const FAINT = "#9CA3AF";
const FONT =
  "'Barlow',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Shared, email-client-safe chrome for all transactional emails. */
function renderEmail(opts: {
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  afterCtaHtml?: string;
  footerHtml: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:${SURFACE};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:${PAPER};border:1px solid ${LINE};">
          <tr>
            <td style="padding:36px 36px 0;">
              <div style="font-family:${FONT};font-weight:800;font-size:20px;letter-spacing:-0.5px;color:${INK};">
                <span style="display:inline-block;width:10px;height:10px;background:${TEAL};margin-right:8px;"></span>AI&nbsp;Ranked&nbsp;<span style="color:${TEAL};">US</span>
              </div>
              <div style="font-family:${FONT};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${FAINT};margin-top:8px;">${opts.eyebrow}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 0;">
              <h1 style="font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-0.02em;margin:0 0 12px;color:${INK};">${opts.heading}</h1>
              <div style="font-family:${FONT};color:${BODY};margin:0 0 26px;font-size:15px;line-height:1.6;">${opts.bodyHtml}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${TEAL};">
                    <a href="${opts.ctaUrl}" style="display:inline-block;font-family:${FONT};color:#ffffff;text-decoration:none;padding:14px 30px;font-weight:700;font-size:15px;letter-spacing:0.01em;">${opts.ctaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${opts.afterCtaHtml ? `<tr><td style="padding:22px 36px 0;">${opts.afterCtaHtml}</td></tr>` : ""}
          <tr>
            <td style="padding:26px 36px 32px;">
              <div style="border-top:1px solid ${LINE};padding-top:18px;">
                ${opts.footerHtml}
                <p style="font-family:${FONT};color:${FAINT};margin:8px 0 0;font-size:11px;letter-spacing:0.04em;">AI&nbsp;Ranked&nbsp;US &middot; a <a href="https://datainc.ai" style="color:${BODY};text-decoration:none;font-weight:600;">DataInc.ai</a> company</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function sendMagicLinkEmail(
  to: string,
  firstName: string,
  magicLink: string,
): Promise<void> {
  const name = (firstName || "").trim() || "there";
  const html = renderEmail({
    eyebrow: "AI Brand Visibility Rankings",
    heading: "Sign in to AI&nbsp;Ranked&nbsp;US",
    bodyHtml: `Hi ${name}, tap the button below to sign in. This link expires in 15&nbsp;minutes and can be used once.`,
    ctaLabel: "Sign in &rarr;",
    ctaUrl: magicLink,
    afterCtaHtml: `<p style="font-family:${FONT};color:${FAINT};margin:0;font-size:12px;line-height:1.6;">Or paste this link into your browser:<br><span style="color:${BODY};word-break:break-all;">${magicLink}</span></p>`,
    footerHtml: `<p style="font-family:${FONT};color:${FAINT};margin:0;font-size:12px;line-height:1.6;">If you didn't request this, you can safely ignore this email.</p>`,
  });

  const response = await sendViaResend({
    from: emailFrom("AI Ranked US"),
    to: [to],
    subject: "Your AI Ranked US sign-in link",
    html,
  });

  if (!response.ok) {
    logger.error(
      { status: response.status, body: response.body },
      "Resend email failed",
    );
    throw new Error(`Failed to send email: ${response.status}`);
  }

  logger.info({ to }, "Magic link email sent");
}

/**
 * Welcome email for a brand-new account explaining the live-beta model: the
 * free ranking works now, paid plans/credits unlock once an admin activates
 * the account. Best-effort — a failure here must not block sign-up.
 */
export async function sendBetaWelcomeEmail(
  to: string,
  firstName: string,
  rankUrl: string,
): Promise<void> {
  const name = (firstName || "").trim() || "there";
  const html = renderEmail({
    eyebrow: "Live beta",
    heading: "Welcome to the AI&nbsp;Ranked&nbsp;US beta",
    bodyHtml:
      `Hi ${name} — you're in. AI&nbsp;Ranked&nbsp;US is in <strong style="color:${INK};">live beta</strong>, ` +
      `so your first brand ranking is on us and ready to run now.` +
      `<br><br>We're switching on access gradually. <strong style="color:${INK};">Paid plans and credits are enabled manually</strong> — ` +
      `once we activate your account you'll be able to subscribe and top up, and we'll email you the moment that's live. ` +
      `Until then you won't be charged.`,
    ctaLabel: "Run your free ranking &rarr;",
    ctaUrl: rankUrl,
    footerHtml: `<p style="font-family:${FONT};color:${FAINT};margin:0;font-size:12px;line-height:1.6;">Questions? Just reply to this email.</p>`,
  });

  const response = await sendViaResend({
    from: emailFrom("AI Ranked US"),
    to: [to],
    subject: "Welcome to the AI Ranked US live beta",
    html,
  });

  if (!response.ok) {
    logger.error(
      { status: response.status, body: response.body },
      "Beta welcome email failed",
    );
    return;
  }
  logger.info({ to }, "Beta welcome email sent");
}
