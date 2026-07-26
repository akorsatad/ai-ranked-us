import { desc } from "drizzle-orm";
import {
  db,
  industriesTable,
  analysisReportsTable,
  type AnalysisReportRow,
} from "@workspace/db";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { latestResponsesByEngine } from "./aggregate";
import { getStoredKey } from "./apiKeys";
import { METRICS } from "./metrics";
import { logger } from "./logger";

const FABLE_MODEL = "claude-fable-5";
const ANALYSIS_KIND = "weekly_trend_overlap";
const CALL_TIMEOUT_MS = 120_000;

/** Call Claude Fable for the narrative analysis (stored key, else env client). */
async function callFable(system: string, prompt: string): Promise<string> {
  const storedKey = await getStoredKey("anthropic");
  let client: {
    messages: { create: (args: unknown) => Promise<unknown> };
  };
  if (storedKey) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic({ apiKey: storedKey }) as never;
  } else {
    client = (await import("@workspace/integrations-anthropic-ai"))
      .anthropic as never;
  }
  // Guard with a Promise.race timeout rather than an SDK AbortSignal (the
  // Anthropic client rejects an unknown `signal` field on this path).
  const call = client.messages.create({
    model: FABLE_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  }) as Promise<{ content?: { type: string; text?: string }[] }>;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Fable analysis timed out")), CALL_TIMEOUT_MS),
  );
  const message = await Promise.race([call, timeout]);
  // Fable may lead with a non-text (e.g. thinking) block — concatenate every
  // text block rather than assuming content[0].
  return (message.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

interface BrandOverlap {
  brandName: string;
  mean: number;
  spread: number; // max - min across engines (0 = perfect overlap)
  engineCount: number;
}
interface IndustryOverlap {
  industryName: string;
  avgSpread: number;
  brands: BrandOverlap[];
}

/**
 * Measure how much the engines' 13-week lookback estimates OVERLAP. For each
 * industry we take the engines' latest-week trend value per brand (averaged
 * over metrics) and compute the spread (max-min) across engines — low spread =
 * strong overlap/agreement, high spread = the engines disagree on the outlook.
 */
async function gatherOverlap(): Promise<IndustryOverlap[]> {
  const industries = (await db.select().from(industriesTable)).filter(
    (i) => i.enabled,
  );
  const out: IndustryOverlap[] = [];
  for (const industry of industries) {
    // brandId → { name, per-engine accumulated latest-week score }
    const brands = new Map<
      number,
      { name: string; byEngine: Map<number, { sum: number; n: number }> }
    >();
    for (const metric of METRICS) {
      const responses = await latestResponsesByEngine(
        industry.id,
        metric.key,
        "trend",
      );
      for (const { engine, response } of responses) {
        for (const bt of response.trend ?? []) {
          const last = bt.points[bt.points.length - 1];
          if (!last) continue;
          let b = brands.get(bt.brandId);
          if (!b) {
            b = { name: bt.brandName, byEngine: new Map() };
            brands.set(bt.brandId, b);
          }
          const e = b.byEngine.get(engine.id) ?? { sum: 0, n: 0 };
          e.sum += last.score;
          e.n += 1;
          b.byEngine.set(engine.id, e);
        }
      }
    }
    const brandRows: BrandOverlap[] = [];
    for (const b of brands.values()) {
      const perEngine = [...b.byEngine.values()].map((e) => e.sum / e.n);
      if (perEngine.length === 0) continue;
      const mean = perEngine.reduce((a, c) => a + c, 0) / perEngine.length;
      const spread = Math.max(...perEngine) - Math.min(...perEngine);
      brandRows.push({
        brandName: b.name,
        mean: Math.round(mean * 10) / 10,
        spread: Math.round(spread * 10) / 10,
        engineCount: perEngine.length,
      });
    }
    if (brandRows.length === 0) continue;
    brandRows.sort((a, b) => b.spread - a.spread);
    const avgSpread =
      Math.round(
        (brandRows.reduce((a, c) => a + c.spread, 0) / brandRows.length) * 10,
      ) / 10;
    out.push({ industryName: industry.name, avgSpread, brands: brandRows });
  }
  return out;
}

function buildFablePrompt(data: IndustryOverlap[]): string {
  const lines: string[] = [];
  for (const ind of data) {
    lines.push(`\n## ${ind.industryName} (avg engine spread ${ind.avgSpread})`);
    for (const b of ind.brands.slice(0, 8)) {
      lines.push(
        `- ${b.brandName}: consensus ${b.mean}, engine spread ${b.spread} across ${b.engineCount} engines`,
      );
    }
  }
  return [
    "You are analyzing how much different AI engines OVERLAP (agree) in their 13-week lookback estimates of US brand perception.",
    "Lower 'engine spread' = the engines agree; higher spread = they diverge on the outlook.",
    "",
    "Data (per industry, per brand — brands sorted by most-divergent first):",
    lines.join("\n"),
    "",
    "Write a concise executive analysis (400-600 words) covering:",
    "1. Overall: where do the engines strongly agree vs disagree on the 13-week outlook?",
    "2. The most divergent brands/industries (where engine estimates overlap least) and what that implies about confidence in those readings.",
    "3. The most convergent readings (high overlap) that can be trusted more.",
    "4. Two or three concrete recommendations for interpreting or acting on this week's data.",
    "Use plain prose with short paragraphs. Do not use markdown headers or bullet symbols.",
  ].join("\n");
}

/** Lay the analysis out as a simple, robust PDF (StandardFonts, no assets). */
async function renderPdf(
  title: string,
  meta: string,
  body: string,
  data: IndustryOverlap[],
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const MARGIN = 56;
  const WIDTH = 595.28; // A4
  const HEIGHT = 841.89;
  const MAXW = WIDTH - MARGIN * 2;
  let page = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;

  const ink = rgb(0.04, 0.06, 0.1);
  const teal = rgb(0.055, 0.66, 0.557);
  const muted = rgb(0.4, 0.44, 0.52);

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([WIDTH, HEIGHT]);
      y = HEIGHT - MARGIN;
    }
  };
  const drawWrapped = (
    text: string,
    size: number,
    f = font,
    color = ink,
    gap = 4,
  ) => {
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") {
        y -= size + gap;
        continue;
      }
      const words = paragraph.split(/\s+/);
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > MAXW && line) {
          newPageIfNeeded(size + gap);
          page.drawText(line, { x: MARGIN, y, size, font: f, color });
          y -= size + gap;
          line = w;
        } else {
          line = test;
        }
      }
      if (line) {
        newPageIfNeeded(size + gap);
        page.drawText(line, { x: MARGIN, y, size, font: f, color });
        y -= size + gap;
      }
    }
  };

  page.drawRectangle({ x: 0, y: HEIGHT - 6, width: WIDTH, height: 6, color: teal });
  drawWrapped(title, 20, bold, ink, 8);
  drawWrapped(meta, 9, font, muted, 10);
  y -= 8;
  drawWrapped(body, 11, font, ink, 6);

  // Data appendix
  y -= 14;
  newPageIfNeeded(40);
  drawWrapped("Appendix — engine overlap by industry", 13, bold, teal, 8);
  for (const ind of data) {
    newPageIfNeeded(30);
    drawWrapped(`${ind.industryName}  ·  avg spread ${ind.avgSpread}`, 11, bold, ink, 5);
    for (const b of ind.brands.slice(0, 8)) {
      drawWrapped(
        `   ${b.brandName} — consensus ${b.mean}, spread ${b.spread} (${b.engineCount} engines)`,
        9,
        font,
        muted,
        3,
      );
    }
    y -= 6;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}

/** Generate and store the weekly 13-week-lookback overlap analysis. */
export async function generateWeeklyTrendAnalysis(
  isoDate: string,
): Promise<AnalysisReportRow | null> {
  const data = await gatherOverlap();
  if (data.length === 0) {
    logger.info("Weekly analysis skipped — no trend data yet");
    return null;
  }
  let body: string;
  let model: string | null = FABLE_MODEL;
  try {
    body = await callFable(
      "You are a precise market-research analyst writing for executives.",
      buildFablePrompt(data),
    );
    if (!body.trim()) throw new Error("Empty analysis");
  } catch (err) {
    logger.error({ err }, "Fable analysis call failed — storing data-only report");
    model = null;
    body =
      "Automated narrative analysis was unavailable for this report (the analysis model could not be reached). The engine-overlap data is included in the appendix below: lower spread means the engines agree on the 13-week outlook; higher spread means they diverge and the reading is less certain.";
  }
  const title = `Weekly 13-Week Lookback — Engine Overlap Analysis`;
  const meta = `Generated ${isoDate} · ${model ?? "data-only"} · ${data.length} industries`;
  const summary = body.slice(0, 280).replace(/\s+/g, " ").trim();
  const pdfBase64 = await renderPdf(title, meta, body, data);
  const [row] = await db
    .insert(analysisReportsTable)
    .values({ kind: ANALYSIS_KIND, title, summary, model, pdfBase64 })
    .returning();
  logger.info({ reportId: row?.id }, "Stored weekly trend analysis");
  return row ?? null;
}

/**
 * Generate the weekly analysis at most once per ~7 days. Called opportunistically
 * from the cron so it doesn't need to be tightly coupled to a specific run.
 */
export async function maybeGenerateWeeklyAnalysis(
  now: Date,
): Promise<AnalysisReportRow | null> {
  const [latest] = await db
    .select({ createdAt: analysisReportsTable.createdAt })
    .from(analysisReportsTable)
    .orderBy(desc(analysisReportsTable.createdAt))
    .limit(1);
  if (latest) {
    const ageDays = (now.getTime() - latest.createdAt.getTime()) / 86_400_000;
    if (ageDays < 6.5) return null;
  }
  return generateWeeklyTrendAnalysis(now.toISOString().slice(0, 10));
}
