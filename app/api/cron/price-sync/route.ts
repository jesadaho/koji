import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import {
  savePriceSyncCronRecord,
  type CronStepResult,
  type PriceSyncCronRecord,
} from "@/src/cronStatusStore";
import { runPctStepPriceAlertTick } from "@/src/pctStepPriceAlertTick";
import { runPriceAlertTick } from "@/src/priceAlertTick";
import { runVolumeSignalAlertTick } from "@/src/volumeSignalAlertTick";
import { runIndicatorAlertTick } from "@/src/indicatorAlertWorker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron ~15 นาที — แจ้งเตือนเป้าราคา + เคลื่อนไหวราคา + Volume signal + RSI 1h
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const steps: PriceSyncCronRecord["steps"] = {
    priceAlerts: { ok: false },
    pctStepAlerts: { ok: false },
    volumeSignalAlerts: { ok: false },
    indicatorAlerts: { ok: false },
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

  const client = createLineClient(config.lineChannelAccessToken);

  await runStep("priceAlerts", async () => {
    await runPriceAlertTick(client);
  });
  await runStep("pctStepAlerts", async () => {
    const r = await runPctStepPriceAlertTick(client);
    return `แจ้ง ${r.notified} ครั้ง`;
  });
  await runStep("volumeSignalAlerts", async () => {
    const r = await runVolumeSignalAlertTick(client);
    return `แจ้ง ${r.notified} ครั้ง`;
  });
  await runStep("indicatorAlerts", async () => {
    const r = await runIndicatorAlertTick(client);
    return `แจ้ง ${r.notified} ครั้ง`;
  });

  const record: PriceSyncCronRecord = {
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    steps,
  };
  try {
    await savePriceSyncCronRecord(record);
  } catch (e) {
    console.error("[cron price-sync] savePriceSyncCronRecord", e);
  }

  const allOk =
    steps.priceAlerts.ok &&
    steps.pctStepAlerts.ok &&
    steps.volumeSignalAlerts.ok &&
    steps.indicatorAlerts.ok;
  return NextResponse.json({ ok: allOk, steps, at: record.at, durationMs: record.durationMs });
}
