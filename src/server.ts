import express from "express";
import cors from "cors";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { middleware, type WebhookEvent } from "@line/bot-sdk";
import { config } from "./config.js";
import { createLineClient, handleWebhookEvent } from "./lineHandler.js";
import { startAlertScheduler } from "./scheduler.js";
import { liffRouter } from "./liffRoutes.js";

const app = express();
const client = createLineClient(config.lineChannelAccessToken);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
  })
);

app.use(express.static(join(rootDir, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "koji" });
});

app.use("/api/liff", express.json({ limit: "32kb" }), liffRouter);

app.post(
  "/webhook",
  middleware({ channelSecret: config.lineChannelSecret }),
  async (req, res) => {
    const events = req.body.events ?? [];
    try {
      await Promise.all(events.map((ev: WebhookEvent) => handleWebhookEvent(client, ev)));
      res.status(200).end();
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  }
);

startAlertScheduler(client, config.priceCheckCron);

app.listen(config.port, () => {
  console.log(`Koji listening on :${config.port}`);
});
