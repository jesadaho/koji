import type { Client } from "@line/bot-sdk";
import { linePushMessages } from "./linePush";
import { bkkTradingSessionId } from "./bkkSession";
import { fetchSimplePrices } from "./cryptoService";
import {
  loadPctStepAlerts,
  replacePctStepAlerts,
  type PctStepAlert,
} from "./pctStepAlertsStore";

const EPS = 1e-10;

function fmtPrice(p: number): string {
  return p.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function fmtUsd(p: number): string {
  return `$${fmtPrice(p)}`;
}

function symLabel(row: PctStepAlert): string {
  const s = row.symbolLabel?.trim();
  return s || row.coinId;
}

function buildDailyMessage(row: PctStepAlert, anchor: number, p: number): string {
  const label = symLabel(row);
  const deltaPct = ((p - anchor) / anchor) * 100;
  const pctStr =
    deltaPct >= 0
      ? `+${deltaPct.toFixed(1)}%`
      : `${deltaPct.toFixed(1)}%`;

  const head =
    deltaPct >= 0
      ? `🟢 Daily Tracking: [${label}]`
      : `⚠️ Daily Tracking: [${label}]`;

  const body =
    deltaPct >= 0
      ? `ราคาขึ้นไปแล้ว ${pctStr} ของวันนี้!`
      : `ราคาลงมาแล้ว ${pctStr} ของวันนี้!`;

  const priceNowLine =
    deltaPct >= 0
      ? `📈 ราคาตอนนี้: ${fmtUsd(p)}`
      : `📉 ราคาตอนนี้: ${fmtUsd(p)}`;
  const openLine =
    deltaPct >= 0
      ? `🔹 ราคาเปิด (07:00): ${fmtUsd(anchor)}`
      : `📈 ราคาเปิด (07:00): ${fmtUsd(anchor)}`;

  return [head, "", body, "", priceNowLine, openLine].join("\n");
}

function buildTrailingMessage(row: PctStepAlert, prevAnchor: number, p: number): string {
  const label = symLabel(row);
  const deltaPct = ((p - prevAnchor) / prevAnchor) * 100;
  const pctStr =
    deltaPct >= 0
      ? `+${Math.abs(deltaPct).toFixed(1)}%`
      : `-${Math.abs(deltaPct).toFixed(1)}%`;

  const head =
    deltaPct >= 0 ? `🚀 Price Alert: [${label}]` : `🔴 Price Alert: [${label}]`;

  const body =
    deltaPct >= 0
      ? `ขยับขึ้นอีก ${pctStr} แล้ว!`
      : `ขยับลงอีก ${pctStr} แล้ว!`;

  return [
    head,
    "",
    body,
    "",
    `🔹 ราคาปัจจุบัน: ${fmtUsd(p)}`,
    `🔹 นับจากเตือนครั้งก่อน: ${fmtUsd(prevAnchor)}`,
  ].join("\n");
}

/**
 * แจ้งเตือนการเคลื่อนไหวราคา (ทุก x%) — เรียกจาก cron ~15 นาที
 */
export async function runPctStepPriceAlertTick(client: Client): Promise<{ notified: number }> {
  const rows = await loadPctStepAlerts();
  if (rows.length === 0) return { notified: 0 };

  const symbols = Array.from(new Set(rows.map((r) => r.coinId)));
  const prices = await fetchSimplePrices(symbols);
  const now = new Date();
  const sessionId = bkkTradingSessionId(now);

  let notified = 0;
  const nextRows: PctStepAlert[] = [];

  for (const row of rows) {
    const q = prices[row.coinId];
    if (!q) {
      nextRows.push(row);
      continue;
    }
    const p = q.usd;
    if (!Number.isFinite(p) || p <= 0) {
      nextRows.push(row);
      continue;
    }

    if (row.mode === "trailing") {
      const anchor = row.trailingAnchorPrice ?? p;
      const diffPct = (Math.abs(p - anchor) / anchor) * 100;
      if (diffPct + EPS >= row.stepPct) {
        try {
          await linePushMessages(client, row.userId, [
            { type: "text", text: buildTrailingMessage(row, anchor, p) },
          ]);
          notified += 1;
        } catch (e) {
          console.error("[pctStepPriceAlertTick] push trailing", row.id, e);
        }
        nextRows.push({
          ...row,
          trailingAnchorPrice: p,
        });
      } else {
        nextRows.push({
          ...row,
          trailingAnchorPrice: row.trailingAnchorPrice ?? p,
        });
      }
      continue;
    }

    // daily_07_bkk
    let anchorDate = row.anchorDateBkk;
    let maxUp = row.maxUpStep ?? 0;
    let maxDown = row.maxDownStep ?? 0;

    if (anchorDate !== sessionId) {
      const anchor = p;
      nextRows.push({
        ...row,
        anchorDateBkk: sessionId,
        anchorPrice: anchor,
        maxUpStep: 0,
        maxDownStep: 0,
      });
      continue;
    }

    const anchor = row.anchorPrice ?? p;
    const x = row.stepPct;
    let newUp = maxUp;
    let newDown = maxDown;

    let n = maxUp + 1;
    while (p + EPS >= anchor * (1 + (n * x) / 100)) {
      newUp = n;
      n += 1;
    }

    let nd = maxDown + 1;
    while (p - EPS <= anchor * (1 - (nd * x) / 100)) {
      newDown = nd;
      nd += 1;
    }

    if (newUp > maxUp || newDown > maxDown) {
      try {
        await linePushMessages(client, row.userId, [
          {
            type: "text",
            text: buildDailyMessage(row, anchor, p),
          },
        ]);
        notified += 1;
      } catch (e) {
        console.error("[pctStepPriceAlertTick] push daily", row.id, e);
      }
    }

    nextRows.push({
      ...row,
      anchorDateBkk: anchorDate,
      anchorPrice: anchor,
      maxUpStep: newUp,
      maxDownStep: newDown,
    });
  }

  await replacePctStepAlerts(nextRows);
  return { notified };
}
