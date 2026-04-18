import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { PctTrailingCronRecord } from "@/src/cronStatusStore";
import { savePctTrailingCronRecord } from "@/src/cronStatusStore";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import { runPctStepTrailingPriceAlertTick } from "@/src/pctStepPriceAlertTick";
import {
  isPriceSpike15mSparkCronEnabled,
  runPriceSpike15mAlertTick,
} from "@/src/priceSpike15mAlertTick";
import { isSparkFollowUpCronEnabled, runSparkFollowUpTick } from "@/src/sparkFollowUpTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Vercel Cron ~5 นาที — เตือน% trailing + Spark (สัญญาณจาก ticker) + Spark follow-up
 * แจ้งเตือน spot–perp basis (ราคาผิดปกติ) → /api/cron/price-sync ทุก ~15 นาที
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();

  const steps: PctTrailingCronRecord["steps"] = {
    trailingPct: { ok: false },
    sparkTicker: { ok: false },
    sparkFollowUp: { ok: false },
  };

  let r = { notified: 0 };
  let spark = { symbolsHit: 0, notifiedPushes: 0 };
  let follow = { checkpoints: 0, resolvedEvents: 0, notifiedPushes: 0 };

  const client = createLineClientForCron();

  const tTrail = Date.now();
  try {
    r = await runPctStepTrailingPriceAlertTick(client);
    steps.trailingPct = {
      ok: true,
      ms: Date.now() - tTrail,
      detail: `แจ้งไปแล้ว ${r.notified} ครั้ง`,
    };
  } catch (e) {
    steps.trailingPct = {
      ok: false,
      ms: Date.now() - tTrail,
      error: errMsg(e),
    };
    console.error("[cron pct-trailing] trailing", e);
  }

  if (steps.trailingPct.ok) {
    const tSpark = Date.now();
    try {
      spark = await runPriceSpike15mAlertTick(client);
      const sparkOn = isPriceSpike15mSparkCronEnabled();
      steps.sparkTicker = {
        ok: true,
        ms: Date.now() - tSpark,
        detail: sparkOn
          ? `จับสัญญาณ ${spark.symbolsHit} คู่ · ส่ง Spark ${spark.notifiedPushes} push`
          : "ปิด (PRICE_SPIKE_15M_ENABLED=0)",
      };
    } catch (e) {
      steps.sparkTicker = {
        ok: false,
        ms: Date.now() - tSpark,
        error: errMsg(e),
      };
      console.error("[cron pct-trailing] spark", e);
    }
  } else {
    steps.sparkTicker = {
      ok: false,
      detail: "ข้าม — เตือน% trailing ไม่สำเร็จ",
    };
  }

  if (steps.trailingPct.ok && steps.sparkTicker.ok) {
    const tFollow = Date.now();
    try {
      follow = await runSparkFollowUpTick(client);
      const followOn = isSparkFollowUpCronEnabled();
      steps.sparkFollowUp = {
        ok: true,
        ms: Date.now() - tFollow,
        detail: followOn
          ? `checkpoint ${follow.checkpoints} · จบเหตุการณ์ ${follow.resolvedEvents} · push ${follow.notifiedPushes}`
          : "ปิด (SPARK_FOLLOWUP_ENABLED=0)",
      };
    } catch (e) {
      steps.sparkFollowUp = {
        ok: false,
        ms: Date.now() - tFollow,
        error: errMsg(e),
      };
      console.error("[cron pct-trailing] follow-up", e);
    }
  } else {
    steps.sparkFollowUp = {
      ok: false,
      detail: "ข้าม — ขั้นตอนก่อนหน้าไม่สำเร็จ",
    };
  }

  try {
    await savePctTrailingCronRecord({
      at: atIso,
      durationMs: Date.now() - started,
      steps,
    });
  } catch (persistErr) {
    console.error("[cron pct-trailing] save status", persistErr);
  }

  const allOk =
    steps.trailingPct.ok && steps.sparkTicker.ok && steps.sparkFollowUp.ok;

  if (!allOk) {
    return NextResponse.json(
      {
        ok: false,
        steps,
        at: atIso,
        durationMs: Date.now() - started,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    scope: "trailing",
    notified: r.notified,
    spark: { symbolsHit: spark.symbolsHit, notifiedPushes: spark.notifiedPushes },
    sparkFollowUp: {
      checkpoints: follow.checkpoints,
      resolvedEvents: follow.resolvedEvents,
      notifiedPushes: follow.notifiedPushes,
    },
    at: atIso,
    durationMs: Date.now() - started,
  });
}
