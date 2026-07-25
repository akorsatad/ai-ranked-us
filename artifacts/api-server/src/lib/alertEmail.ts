import { sendViaResend, emailFrom } from "./emailTransport";
import { logger } from "./logger";

export interface AlertEmailItem {
  brandName: string;
  industryName: string;
  metricLabel: string;
  kind: "score_drop" | "rank_drop";
  previousValue: number; // display units (score pts or rank position)
  currentValue: number;
  delta: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describe(item: AlertEmailItem): string {
  if (item.kind === "score_drop") {
    return `score worsened by ${item.delta.toFixed(1)} pts (${item.previousValue.toFixed(1)} → ${item.currentValue.toFixed(1)})`;
  }
  return `fell ${item.delta} position${item.delta === 1 ? "" : "s"} (#${item.previousValue} → #${item.currentValue})`;
}

export interface SendEmailResult {
  ok: boolean;
  /** Human-readable provider error when ok is false. */
  error?: string;
}

function buildDigest(
  runId: number,
  items: AlertEmailItem[],
  opts?: { test?: boolean },
): { subject: string; html: string; text: string } {
  const testPrefix = opts?.test ? "[Test] " : "";
  const subject = `${testPrefix}AI Rank: ${items.length} new brand alert${items.length === 1 ? "" : "s"} (run #${runId})`;

  const rows = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;"><strong>${escapeHtml(i.brandName)}</strong></td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(i.industryName)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(i.metricLabel)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#b91c1c;">${escapeHtml(describe(i))}</td>
        </tr>`,
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;">
      <h2 style="margin:16px 0 4px;">Brand alert digest</h2>
      <p style="color:#555;margin:0 0 16px;">Survey run #${runId} detected ${items.length} sharp deterioration${items.length === 1 ? "" : "s"}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;background:#f5f5f5;">
            <th style="padding:8px 12px;">Brand</th>
            <th style="padding:8px 12px;">Industry</th>
            <th style="padding:8px 12px;">Metric</th>
            <th style="padding:8px 12px;">Change</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px;">You are receiving this because alert emails are enabled in AI Rank. Turn them off on the Alerts page.</p>
    </div>`;

  const text = items
    .map((i) => `- ${i.brandName} (${i.industryName}, ${i.metricLabel}): ${describe(i)}`)
    .join("\n");

  return {
    subject,
    html,
    text: `Survey run #${runId} detected ${items.length} new alert(s):\n\n${text}`,
  };
}

async function sendEmail(
  recipient: string,
  subject: string,
  html: string,
  text: string,
): Promise<SendEmailResult> {
  try {
    const response = await sendViaResend({
      from: emailFrom("AI Rank Alerts"),
      to: [recipient],
      subject,
      html,
      text,
    });
    if (!response.ok) {
      const body = response.body;
      logger.error({ status: response.status, body, recipient }, "Alert email failed");
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed?.message) detail = parsed.message;
      } catch {
        // keep raw body
      }
      return {
        ok: false,
        error: detail
          ? `Email provider error (${response.status}): ${detail}`
          : `Email provider error (${response.status})`,
      };
    }
    logger.info({ recipient }, "Alert email sent");
    return { ok: true };
  } catch (error) {
    logger.error({ error, recipient }, "Alert email failed");
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email send failure",
    };
  }
}

/**
 * Send an alert digest email via the Resend connection. Failures are logged
 * and reported as `false` so a mail failure never breaks alert detection.
 */
export async function sendAlertDigestEmail(
  recipient: string,
  runId: number,
  items: AlertEmailItem[],
): Promise<boolean> {
  const { subject, html, text } = buildDigest(runId, items);
  return (await sendEmail(recipient, subject, html, text)).ok;
}

/**
 * Send a sample digest to verify delivery works. Returns the provider error
 * detail on failure so the UI can surface it.
 */
export async function sendTestAlertEmail(recipient: string): Promise<SendEmailResult> {
  const sampleItems: AlertEmailItem[] = [
    {
      brandName: "Example Brand",
      industryName: "Sample Industry",
      metricLabel: "Positive Sentiment",
      kind: "score_drop",
      previousValue: 82.5,
      currentValue: 71.0,
      delta: 11.5,
    },
    {
      brandName: "Another Brand",
      industryName: "Sample Industry",
      metricLabel: "Overall Rank",
      kind: "rank_drop",
      previousValue: 2,
      currentValue: 5,
      delta: 3,
    },
  ];
  const { subject, html, text } = buildDigest(0, sampleItems, { test: true });
  return sendEmail(
    recipient,
    subject,
    `<p style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:16px auto 0;color:#555;">This is a <strong>test</strong> alert email from AI Rank — the data below is sample data.</p>${html}`,
    `This is a TEST alert email from AI Rank — the data below is sample data.\n\n${text}`,
  );
}
