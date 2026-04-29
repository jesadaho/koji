import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import {
  saveHourlyCronRecord,
  type CronStepResult,
  type HourlyCronRecord,
} from "@/src/cronStatusStore";
import { runContractConditionTick } from "@/src/contractConditionTick";
import { runFundingHistoryTick } from "@/src/fundingHistoryTick";
import { notifyCronFailure } from "@/src/cronFailureNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron ทุกชั่วโมง — สัญญา / ประวัติ funding (ไม่รวมแจ้งเตือนราคา — ใช้ /api/cron/price-sync)
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  const steps: HourlyCronRecord["steps"] = {
    contractCondition: { ok: false },
    fundingHistory: { ok: false },
  };

  async function runStep(
    key: keyof HourlyCronRecord["steps"],
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
      console.error(`[cron price-alerts] ${key}`, e);
      steps[key] = { ok: false, ms: Date.now() - t0, error: msg };
    }
  }

  const client = createLineClientForCron();

  await runStep("contractCondition", async () => {
    await runContractConditionTick(client);
  });
  await runStep("fundingHistory", async () => {
    const r = await runFundingHistoryTick();
    return `${r.rowsSampled} คู่ · bucket ${r.bucket}`;
  });

  const record: HourlyCronRecord = {
    at: atIso,
    durationMs: Date.now() - started,
    steps,
  };
  try {
    await saveHourlyCronRecord(record);
  } catch (e) {
    console.error("[cron] saveHourlyCronRecord", e);
  }

  const allOk = steps.contractCondition.ok && steps.fundingHistory.ok;
  if (!allOk) {
    await notifyCronFailure({
      scope: "price-alerts",
      atIso,
      durationMs: record.durationMs,
      steps,
    });
  }
  return NextResponse.json({ ok: allOk, steps, at: record.at, durationMs: record.durationMs });
}
