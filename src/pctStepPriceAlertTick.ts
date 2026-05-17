import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { bkkTradingSessionId } from "./bkkSession";
import { fetchSimplePrices } from "./cryptoService";
import {
  acquirePctStepAlertsLock,
  releasePctStepAlertsLock,
} from "./remoteJsonStore";
import {
  loadPctStepAlerts,
  replacePctStepAlerts,
  type PctStepAlert,
  type PctStepMode,
} from "./pctStepAlertsStore";
import {
  buildTrailingAlertMessage,
  evaluateTrailingPriceStep,
} from "./pctTrailingAlertUtils";

const EPS = 1e-10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** read-modify-write ภายใต้ lock — กัน race ระหว่าง cron trailing 5 นาที กับ daily 15 นาที */
async function withPctStepStoreLock<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const got = await acquirePctStepAlertsLock();
    if (got) {
      try {
        return await run();
      } finally {
        await releasePctStepAlertsLock();
      }
    }
    await sleep(200 + attempt * 100);
  }
  throw new Error("pct_step_alerts: ล็อก store ไม่สำเร็จ (ลองครบแล้ว)");
}

/** trailing = เช็คถี่ (cron 5 นาที) · daily = รายวัน 07:00 (cron 15 นาที) · both = รวมในครั้งเดียว */
export type PctStepScope = "trailing" | "daily" | "both";

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
  return buildTrailingAlertMessage(symLabel(row), prevAnchor, p);
}

function coinIdsForScope(rows: PctStepAlert[], scope: PctStepScope): string[] {
  if (scope === "both") {
    return Array.from(new Set(rows.map((r) => r.coinId)));
  }
  const modeFilter: PctStepMode = scope === "trailing" ? "trailing" : "daily_07_bkk";
  return Array.from(new Set(rows.filter((r) => r.mode === modeFilter).map((r) => r.coinId)));
}

async function runPctStepPriceAlertTickInner(
  client: Client,
  scope: PctStepScope,
): Promise<{ notified: number }> {
  const rows = await loadPctStepAlerts();
  if (rows.length === 0) return { notified: 0 };

  const symbols = coinIdsForScope(rows, scope);
  if (symbols.length === 0) return { notified: 0 };

  const prices = await fetchSimplePrices(symbols);
  const now = new Date();
  const sessionId = bkkTradingSessionId(now);

  let notified = 0;
  const nextRows: PctStepAlert[] = [];

  for (const row of rows) {
    const runTrailing = scope === "both" || scope === "trailing";
    const runDaily = scope === "both" || scope === "daily";

    if (row.mode === "trailing") {
      if (!runTrailing) {
        nextRows.push(row);
        continue;
      }
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

      const step = evaluateTrailingPriceStep(p, row.trailingAnchorPrice, row.stepPct);
      if (step.fired) {
        try {
          await sendAlertNotification(
            client,
            row.userId,
            buildTrailingMessage(row, step.prevAnchor, step.price)
          );
          notified += 1;
        } catch (e) {
          console.error("[pctStepPriceAlertTick] push trailing", row.id, e);
        }
        nextRows.push({
          ...row,
          trailingAnchorPrice: step.nextAnchor,
        });
      } else {
        nextRows.push({
          ...row,
          trailingAnchorPrice: step.nextAnchor,
        });
      }
      continue;
    }

    // daily_07_bkk
    if (!runDaily) {
      nextRows.push(row);
      continue;
    }

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
        await sendAlertNotification(client, row.userId, buildDailyMessage(row, anchor, p));
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

/**
 * แจ้งเตือนการเคลื่อนไหวราคา (ทุก x%)
 * - default `both` = trailing + daily ในครั้งเดียว (ทดสอบ/เรียกเอง)
 * - production: ใช้ `runPctStepTrailingPriceAlertTick` (5 นาที) + `runPctStepDailyPriceAlertTick` (15 นาที)
 */
export async function runPctStepPriceAlertTick(
  client: Client,
  scope: PctStepScope = "both",
): Promise<{ notified: number }> {
  return withPctStepStoreLock(() => runPctStepPriceAlertTickInner(client, scope));
}

/** Trailing เท่านั้น — เรียกจาก cron ทุก ~5 นาที */
export async function runPctStepTrailingPriceAlertTick(
  client: Client,
): Promise<{ notified: number }> {
  return runPctStepPriceAlertTick(client, "trailing");
}

/** Daily (07:00 ไทย) เท่านั้น — เรียกจาก /api/cron/price-sync ~15 นาที */
export async function runPctStepDailyPriceAlertTick(
  client: Client,
): Promise<{ notified: number }> {
  return runPctStepPriceAlertTick(client, "daily");
}
