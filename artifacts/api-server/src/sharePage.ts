import { Router, type IRouter } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import { METRICS } from "./lib/metrics";
import { latestResponsesByEngine, averageEntries } from "./lib/aggregate";

/**
 * Serves the SPA's index.html for /industry/:id with page-specific
 * Open Graph / Twitter meta tags injected, so shared links show an
 * industry-specific preview. Client-side navigation is unaffected —
 * this only handles full page loads (browsers and social crawlers).
 */

const IS_PROD = process.env.NODE_ENV === "production";
const VITE_DEV_PORT = process.env.AI_RANK_DEV_PORT || "21163";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveDistIndexHtml(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // from artifacts/api-server/dist -> artifacts/ai-rank/dist/public
    path.resolve(here, "..", "..", "ai-rank", "dist", "public", "index.html"),
    path.resolve(
      process.cwd(),
      "artifacts",
      "ai-rank",
      "dist",
      "public",
      "index.html",
    ),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try next
    }
  }
  return null;
}

async function loadBaseHtml(requestPath: string): Promise<string | null> {
  if (IS_PROD) {
    return resolveDistIndexHtml();
  }
  try {
    const resp = await fetch(`http://localhost:${VITE_DEV_PORT}${requestPath}`, {
      headers: { accept: "text/html" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

interface PageMeta {
  title: string;
  description: string;
  imageUrl: string;
  pageUrl: string;
}

function injectMeta(html: string, meta: PageMeta): string {
  const title = escapeHtmlAttr(meta.title);
  const description = escapeHtmlAttr(meta.description);
  const imageUrl = escapeHtmlAttr(meta.imageUrl);
  const pageUrl = escapeHtmlAttr(meta.pageUrl);

  const replacements: [RegExp, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${description}" />`,
    ],
    [
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${title}" />`,
    ],
    [
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${description}" />`,
    ],
    [
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${pageUrl}" />`,
    ],
    [
      /<meta property="og:image" content="[^"]*" \/>/,
      `<meta property="og:image" content="${imageUrl}" />`,
    ],
    [
      /<meta property="og:image:alt" content="[^"]*" \/>/,
      `<meta property="og:image:alt" content="${title}" />`,
    ],
    [
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${title}" />`,
    ],
    [
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${description}" />`,
    ],
    [
      /<meta name="twitter:image" content="[^"]*" \/>/,
      `<meta name="twitter:image" content="${imageUrl}" />`,
    ],
  ];
  let out = html;
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function requestOrigin(req: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
}): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ??
    (req.headers.host as string | undefined) ??
    "localhost";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

const router: IRouter = Router();

router.get("/industry/:industryId", async (req, res): Promise<void> => {
  const baseHtml = await loadBaseHtml(req.path);
  if (!baseHtml) {
    // Can't reach the SPA build/dev server; let the client handle it.
    res.status(503).send("Frontend unavailable");
    return;
  }

  const industryId = Number(req.params.industryId);
  let html = baseHtml;

  if (Number.isInteger(industryId) && industryId > 0) {
    try {
      const [industry] = await db
        .select()
        .from(industriesTable)
        .where(eq(industriesTable.id, industryId));
      if (industry && industry.enabled) {
        const origin = requestOrigin(req);
        const metric = METRICS[0];
        const responses = await latestResponsesByEngine(
          industry.id,
          metric.key,
        );
        const entries = averageEntries(
          responses.map((r) => r.response),
          metric.higherIsBetter,
        );
        const topNames = entries.slice(0, 3).map((e) => e.brandName);

        const title = `${industry.name} — AI Brand Rankings | AI Ranked US`;
        const description =
          topNames.length > 0
            ? `See how leading AI models rank ${industry.name.toLowerCase()} brands. Top ranked: ${topNames.join(", ")}. Track AI visibility, sentiment, and ranking changes.`
            : `See how leading AI models rank and describe ${industry.name.toLowerCase()} brands. Track AI visibility, sentiment, and ranking changes.`;
        // Use the dynamic per-industry image only when we have ranking data;
        // otherwise fall back to the site-wide og-image.png already in the HTML.
        const imageUrl =
          topNames.length > 0
            ? `${origin}/api/og/industries/${industry.id}/image.png`
            : `${origin}/og-image.png`;

        html = injectMeta(html, {
          title,
          description,
          imageUrl,
          pageUrl: `${origin}/industry/${industry.id}`,
        });
      }
    } catch (err) {
      req.log.error({ err }, "Failed to build industry share meta");
      // Serve unmodified HTML with site-wide defaults.
    }
  }

  res
    .status(200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Cache-Control", "no-cache")
    .send(html);
  return;
});

export default router;
