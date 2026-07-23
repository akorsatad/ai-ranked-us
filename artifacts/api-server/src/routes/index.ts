import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import overviewRouter from "./overview";
import industriesRouter from "./industries";
import runsRouter from "./runs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(overviewRouter);
router.use(industriesRouter);
router.use(runsRouter);

export default router;
