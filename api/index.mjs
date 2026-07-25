// Vercel serverless function entry. The real app is bundled by
// `pnpm --filter @workspace/api-server run build:vercel` into api/_server/
// (underscore-prefixed paths are not exposed as separate endpoints).
// vercel.json rewrites /api/* and /industry/:id here.
export { default } from "./_server/vercel.mjs";
