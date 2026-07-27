import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import sharePageRouter from "./sharePage";
import { logger } from "./lib/logger";
import { isGoogleAuthConfigured } from "./lib/authConfig";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Credentialed CORS: when an explicit origin allowlist is configured
// (CORS_ALLOWED_ORIGINS, comma-separated, falling back to APP_BASE_URL),
// only those origins are reflected. Without one (Replit dev), the previous
// reflect-any-origin behavior is kept.
const corsAllowlist = (
  process.env.CORS_ALLOWED_ORIGINS ??
  process.env.APP_BASE_URL ??
  ""
)
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin:
      corsAllowlist.length > 0
        ? (origin, callback) => {
            // Non-browser or same-origin requests carry no Origin header.
            callback(null, !origin || corsAllowlist.includes(origin));
          }
        : true,
  }),
);
app.use(cookieParser());
// Stripe webhook needs the RAW body for signature verification, so parse it as
// a Buffer BEFORE express.json() (which would otherwise consume the stream).
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Admin auth is native Google OIDC (routes/googleAuth.ts). Without
// credentials the public app still works; admin endpoints return 503.
if (!isGoogleAuthConfigured()) {
  logger.warn(
    "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — admin sign-in disabled",
  );
}

app.use("/api", router);
app.use(sharePageRouter);

export default app;
