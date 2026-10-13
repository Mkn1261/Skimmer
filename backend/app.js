import "dotenv/config";
import express from "express";
import cors from "cors";

import crawlRoutes from "./routes/crawlRoutes.js";
import ragRoutes from "./routes/ragRoutes.js";

const app = express();

// ALLOWED_ORIGIN is a comma separated list
const allowlist = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const origin = allowlist.length && !allowlist.includes("*") ? allowlist : "*";

app.use(cors({ origin, methods: ["GET", "POST"] }));

app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => res.send("Skimmer API"));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/crawl", crawlRoutes);
app.use("/api/rag", ragRoutes);

app.use((_req, res) => res.status(404).json({ error: "Route not found." }));

app.use((err, _req, res, _next) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

export default app;
