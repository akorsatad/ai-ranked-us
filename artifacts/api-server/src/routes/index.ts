import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import overviewRouter from "./overview";
import industriesRouter from "./industries";
import moversRouter from "./movers";
import runsRouter from "./runs";
import adminRouter from "./admin";
import alertsRouter from "./alerts";
import ogRouter from "./og";
import authRouter from "./auth";
import rankRouter from "./rank";
import cronRouter from "./cron";
import googleAuthRouter from "./googleAuth";
import pricingRouter from "./pricing";
import schedulesRouter from "./schedules";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
// Native Google OIDC admin sign-in (public entry points; mounted early)
router.use(googleAuthRouter);
router.use(catalogRouter);
router.use(overviewRouter);
router.use(industriesRouter);
router.use(moversRouter);
router.use(runsRouter);
// Pricing: public GET /pricing + admin GET/PUT /admin/pricing (own
// requireAdmin). Mounted before adminRouter so its /admin/pricing routes
// resolve here rather than falling through the path-scoped admin gate.
router.use(pricingRouter);
router.use(schedulesRouter);
// Stripe billing: public /stripe/config, session-gated checkout/portal, and the
// signature-verified webhook (raw body set up in app.ts).
router.use(stripeRouter);
// Admin routes are protected by the session-based requireAdmin middleware
// inside adminRouter (path-scoped — see admin.ts)
router.use(adminRouter);
router.use(alertsRouter);
router.use(ogRouter);
router.use(authRouter);
router.use(rankRouter);
// CRON_SECRET-protected scheduler endpoint for serverless deployments
router.use(cronRouter);

export default router;
