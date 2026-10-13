import { Router } from "express";
import { askQuestion } from "../controllers/ragController.js";

const router = Router();

router.post("/ask", askQuestion);

export default router;