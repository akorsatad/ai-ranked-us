import { ReplitConnectors } from "@replit/connectors-sdk";

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

export interface TransportResult {
  ok: boolean;
  status: number;
  /** Raw provider response body, only populated on failure. */
  body: string;
}

/**
 * Sends an email through Resend. When RESEND_API_KEY is set (e.g. on
 * Vercel or any non-Replit host) the Resend HTTP API is called directly;
 * otherwise the request goes through the Replit Resend connector proxy,
 * which only exists on Replit deployments.
 */
export async function sendViaResend(
  message: OutgoingEmail,
): Promise<TransportResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: response.ok ? "" : await response.text().catch(() => ""),
    };
  }

  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? "" : await response.text().catch(() => ""),
  };
}

/**
 * Sender address for outgoing mail. Resend's sandbox sender only delivers
 * to the account owner; set EMAIL_FROM to an address on a verified domain
 * for real deliverability.
 */
export function emailFrom(displayName: string): string {
  const configured = process.env.EMAIL_FROM;
  if (!configured) return `${displayName} <onboarding@resend.dev>`;
  // Allow either a bare address or a full "Name <addr>" value.
  return configured.includes("<") ? configured : `${displayName} <${configured}>`;
}
