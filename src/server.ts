import express from "express";
import cors from "cors";
import { join } from "node:path";
import { middleware, type WebhookEvent } from "@line/bot-sdk";
import { config } from "./config";
import { createLineClient, handleWebhookEvent } from "./lineHandler";
import { startAlertScheduler } from "./scheduler";
import { liffRouter } from "./liffRoutes";

const app = express();
const client = createLineClient(config.lineChannelAccessToken);
const rootDir = process.cwd();

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
