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

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(overviewRouter);
router.use(industriesRouter);
router.use(moversRouter);
router.use(runsRouter);
// Admin routes are protected by Clerk-based requireAdmin middleware inside adminRouter
router.use(adminRouter);
router.use(alertsRouter);
router.use(ogRouter);
router.use(authRouter);
router.use(rankRouter);

export default router;
