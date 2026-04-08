import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { createLineClient } from "@/src/lineHandler";
import { saveCronRunRecord, type CronRunRecord, type CronStepResult } from "@/src/cronStatusStore";
import { runContractConditionTick } from "@/src/contractConditionTick";
import { runFundingHistoryTick } from "@/src/fundingHistoryTick";
import { runPriceAlertTick } from "@/src/priceAlertTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron หรือเรียกด้วย GET + Authorization: Bearer CRON_SECRET
 * (ถ้าไม่ตั้ง CRON_SECRET ใน production จะปฏิเสธ)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret) {
      return NextResponse.json({ error: "ตั้ง CRON_SECRET บน Vercel" }, { status: 503 });
    }
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const started = Date.now();
  const steps: CronRunRecord["steps"] = {
    priceAlerts: { ok: false },
    contractCondition: { ok: false },
    fundingHistory: { ok: false },
  };

  async function runStep<K extends keyof CronRunRecord["steps"]>(
    key: K,
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
      console.error(`[cron] ${key}`, e);
      steps[key] = { ok: false, ms: Date.now() - t0, error: msg };
    }
  }

  const client = createLineClient(config.lineChannelAccessToken);

  await runStep("priceAlerts", async () => {
    await runPriceAlertTick(client);
  });
  await runStep("contractCondition", async () => {
    await runContractConditionTick(client);
  });
  await runStep("fundingHistory", async () => {
    const r = await runFundingHistoryTick();
    return `${r.rowsSampled} คู่ · bucket ${r.bucket}`;
  });

  const record: CronRunRecord = {
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    steps,
  };
  try {
    await saveCronRunRecord(record);
  } catch (e) {
    console.error("[cron] saveCronRunRecord", e);
  }

  const allOk = steps.priceAlerts.ok && steps.contractCondition.ok && steps.fundingHistory.ok;
  return NextResponse.json({ ok: allOk, steps, at: record.at, durationMs: record.durationMs });
}
