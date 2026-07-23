import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Resolve assets relative to the running bundle (dist/index.mjs) with a
// fallback to the source tree layout, so both bundled and ts-node style
// execution find the fonts.
function resolveAsset(rel: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "assets", rel), // dist/../assets
    path.resolve(here, "..", "..", "assets", rel), // src/lib/../../assets
    path.resolve(process.cwd(), "artifacts", "api-server", "assets", rel),
    path.resolve(process.cwd(), "assets", rel),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`OG asset not found: ${rel}`);
}

let fontFiles: string[] | null = null;
function loadFonts(): string[] {
  if (!fontFiles) {
    fontFiles = [
      resolveAsset("fonts/inter-400.ttf"),
      resolveAsset("fonts/inter-700.ttf"),
    ];
  }
  return fontFiles;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export interface OgIndustryData {
  industryName: string;
  metricLabel: string;
  topBrands: { rank: number; name: string; score: number }[];
}

const WIDTH = 1200;
const HEIGHT = 630;

function buildSvg(data: OgIndustryData): string {
  const { industryName, metricLabel, topBrands } = data;
  const title = truncate(industryName, 42);
  const titleSize = title.length > 28 ? 52 : 64;

  const rows = topBrands
    .slice(0, 5)
    .map((brand, i) => {
      const y = 250 + i * 66;
      const medal =
        brand.rank === 1 ? "#F5C542" : brand.rank === 2 ? "#B8C4CE" : brand.rank === 3 ? "#C9906B" : "#3B4A5C";
      return `
      <g>
        <rect x="72" y="${y - 40}" width="700" height="56" rx="12" fill="#131C28"/>
        <circle cx="108" cy="${y - 12}" r="18" fill="${medal}"/>
        <text x="108" y="${y - 5}" font-family="Inter" font-size="20" font-weight="700" fill="#0B1220" text-anchor="middle">${brand.rank}</text>
        <text x="144" y="${y - 4}" font-family="Inter" font-size="26" font-weight="700" fill="#F2F6FA">${escapeXml(truncate(brand.name, 34))}</text>
        <text x="742" y="${y - 4}" font-family="Inter" font-size="24" font-weight="400" fill="#7FD1AE" text-anchor="end">${brand.score.toFixed(1)}</text>
      </g>`;
    })
    .join("");

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1220"/>
      <stop offset="100%" stop-color="#101B2E"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3DDC97"/>
      <stop offset="100%" stop-color="#2EA0F5"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="1050" cy="120" r="320" fill="#182740" opacity="0.55"/>
  <circle cx="1140" cy="540" r="220" fill="#14304A" opacity="0.5"/>
  <rect x="72" y="64" width="64" height="8" rx="4" fill="url(#accent)"/>
  <text x="72" y="112" font-family="Inter" font-size="28" font-weight="700" fill="#3DDC97" letter-spacing="2">AI RANKED US</text>
  <text x="72" y="${titleSize > 52 ? 186 : 178}" font-family="Inter" font-size="${titleSize}" font-weight="700" fill="#FFFFFF">${escapeXml(title)}</text>
  <text x="820" y="235" font-family="Inter" font-size="22" font-weight="400" fill="#8FA3B8">Top brands by</text>
  <text x="820" y="266" font-family="Inter" font-size="24" font-weight="700" fill="#E4ECF4">${escapeXml(metricLabel)}</text>
  <text x="820" y="330" font-family="Inter" font-size="20" font-weight="400" fill="#8FA3B8">as ranked by leading</text>
  <text x="820" y="358" font-family="Inter" font-size="20" font-weight="400" fill="#8FA3B8">AI models</text>
  ${rows}
  <text x="72" y="588" font-family="Inter" font-size="22" font-weight="400" fill="#5E7186">airanked.us — how AI models rank and describe your brand</text>
</svg>`;
}

interface CacheEntry {
  png: Buffer;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function renderIndustryOgImage(
  cacheKey: string,
  data: OgIndustryData,
): Buffer {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.png;

  const svg = buildSvg(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      fontFiles: loadFonts(),
      defaultFontFamily: "Inter",
      loadSystemFonts: false,
    },
  });
  const png = resvg.render().asPng();
  cache.set(cacheKey, { png: Buffer.from(png), expiresAt: now + CACHE_TTL_MS });
  return cache.get(cacheKey)!.png;
}
