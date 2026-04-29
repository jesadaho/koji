import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import {
  savePriceSyncCronRecord,
  type CronStepResult,
  type PriceSyncCronRecord,
} from "@/src/cronStatusStore";
import { runPctStepDailyPriceAlertTick } from "@/src/pctStepPriceAlertTick";
import { runPriceAlertTick } from "@/src/priceAlertTick";
import { runVolumeSignalAlertTick } from "@/src/volumeSignalAlertTick";
import { runIndicatorAlertTick } from "@/src/indicatorAlertWorker";
import { runSpotFutBasisAlertTick } from "@/src/spotFutBasisAlertTick";
import { runThreeGreenDailyTechnicalAlertTick } from "@/src/threeGreenDailyAlertTick";
import { notifyCronFailure } from "@/src/cronFailureNotify";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron ~15 นาที — แจ้งเตือนเป้าราคา + เตือน% รายวัน (07:00 ไทย) + Volume signal + RSI 1h + spot–perp basis + 3 เขียว Day1 (คู่ใหม่ → technical)
 * เตือน% trailing → /api/cron/pct-trailing ทุก ~5 นาที
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  const steps: PriceSyncCronRecord["steps"] = {
    priceAlerts: { ok: false },
    pctStepAlerts: { ok: false },
    volumeSignalAlerts: { ok: false },
    indicatorAlerts: { ok: false },
    spotFutBasisAlerts: { ok: false },
    threeGreenDailyTechnical: { ok: false },
  };

  async function runStep(
    key: keyof PriceSyncCronRecord["steps"],
    fn: () => Promise<string | void>
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const detail = await fn();
      const d: CronStepResult = { ok: true, ms: Date.now() - t0 };
      if (detail) d.detail = detail;
      steps[key] = d;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron price-sync] ${key}`, e);
      steps[key] = { ok: false, ms: Date.now() - t0, error: msg };
    }
  }

  const client = createLineClientForCron();

  await runStep("priceAlerts", async () => {
    await runPriceAlertTick(client);
  });
  await runStep("pctStepAlerts", async () => {
    const r = await runPctStepDailyPriceAlertTick(client);
    return `แจ้ง ${r.notified} ครั้ง (เตือน% รายวัน)`;
  });
  await runStep("volumeSignalAlerts", async () => {
    const r = await runVolumeSignalAlertTick(client);
    return `แจ้ง ${r.notified} ครั้ง`;
  });
  await runStep("indicatorAlerts", async () => {
    const r = await runIndicatorAlertTick(client);
    return r.detail ?? `แจ้ง ${r.notified} ครั้ง`;
  });
  await runStep("spotFutBasisAlerts", async () => {
    const r = await runSpotFutBasisAlertTick(client);
    return `แจ้ง ${r.symbolsAlerted} สัญญา · ${r.notifiedPushes} push`;
  });
  await runStep("threeGreenDailyTechnical", async () => {
    const r = await runThreeGreenDailyTechnicalAlertTick();
    return r.detail;
  });

  const record: PriceSyncCronRecord = {
    at: atIso,
    durationMs: Date.now() - started,
    steps,
  };
  try {
    await savePriceSyncCronRecord(record);
  } catch (e) {
    console.error("[cron price-sync] savePriceSyncCronRecord", e);
  }

  /** ฟิลด์ volumeSignalAlerts / indicatorAlerts อาจไม่มีในบันทึกเก่า — ถ้าไม่มีถือว่าไม่ล้ม step นั้น */
  const allOk =
    steps.priceAlerts.ok &&
    steps.pctStepAlerts.ok &&
    steps.volumeSignalAlerts?.ok !== false &&
    steps.indicatorAlerts?.ok !== false &&
    steps.spotFutBasisAlerts?.ok !== false &&
    steps.threeGreenDailyTechnical?.ok !== false;
  if (!allOk) {
    await notifyCronFailure({
      scope: "price-sync",
      atIso,
      durationMs: record.durationMs,
      steps,
    });
  }
  return NextResponse.json({ ok: allOk, steps, at: record.at, durationMs: record.durationMs });
}
