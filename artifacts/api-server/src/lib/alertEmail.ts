import { ReplitConnectors } from "@replit/connectors-sdk";
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

/**
 * Send an alert digest email via the Resend connection. Throws are caught
 * and logged by the caller boundary here so a mail failure never breaks
 * alert detection.
 */
export async function sendAlertDigestEmail(
  recipient: string,
  runId: number,
  items: AlertEmailItem[],
): Promise<boolean> {
  const subject = `AI Rank: ${items.length} new brand alert${items.length === 1 ? "" : "s"} (run #${runId})`;

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

  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "AI Rank Alerts <onboarding@resend.dev>",
        to: [recipient],
        subject,
        html,
        text: `Survey run #${runId} detected ${items.length} new alert(s):\n\n${text}`,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body, recipient, runId },
        "Alert digest email failed",
      );
      return false;
    }
    logger.info({ recipient, runId, alerts: items.length }, "Alert digest email sent");
    return true;
  } catch (error) {
    logger.error({ error, recipient, runId }, "Alert digest email failed");
    return false;
  }
}
