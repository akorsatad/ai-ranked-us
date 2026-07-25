import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";

// Bundles the serverless entry (src/vercel.ts) into <repo>/api/_server/
// for Vercel. Differences from build.mjs (the Replit long-running build):
// - entry exports the Express app instead of calling app.listen
// - no esbuild-plugin-pino: NODE_ENV=production never activates the
//   pino-pretty transport, so no worker files are needed
// - only true native modules stay external; they must also be declared in
//   the ROOT package.json so Vercel's file tracer finds them from api/.

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(artifactDir, "..", "..", "api", "_server");

await rm(outDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/vercel.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  external: ["@resvg/resvg-js", "pg-native"],
  sourcemap: "linked",
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});
