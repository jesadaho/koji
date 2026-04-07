import cron from "node-cron";
import type Client from "@line/bot-sdk";
import { loadAlerts, markFired } from "./alertsStore";
import { fetchSimplePrices } from "./cryptoService";

export function startAlertScheduler(client: Client, cronExpr: string): void {
  cron.schedule(cronExpr, async () => {
    try {
      const alerts = await loadAlerts();
      if (alerts.length === 0) return;
      const ids = [...new Set(alerts.map((a) => a.coinId))];
      const prices = await fetchSimplePrices(ids);
      for (const a of alerts) {
        const q = prices[a.coinId];
        if (!q) continue;
        const p = q.usd;
        const hit = a.direction === "above" ? p >= a.targetUsd : p <= a.targetUsd;
        if (!hit) continue;
        const chg =
          q.usd_24h_change !== undefined
            ? ` (24h ${q.usd_24h_change >= 0 ? "+" : ""}${q.usd_24h_change.toFixed(2)}%)`
            : "";
        try {
          await client.pushMessage(a.userId, [
            {
              type: "text",
              text: `🔔 Koji (MEXC Futures)\n${a.coinId}\nถึงเงื่อนไขแล้ว\nราคา ~ ${p.toLocaleString("en-US", { maximumFractionDigits: 8 })} USDT${chg}\nเงื่อนไข: ${a.direction === "above" ? "≥" : "≤"} ${a.targetUsd} USDT`,
            },
          ]);
          await markFired(a.id);
        } catch (e) {
          console.error("push alert failed", a.id, e);
        }
      }
    } catch (e) {
      console.error("scheduler tick failed", e);
    }
  });
}
