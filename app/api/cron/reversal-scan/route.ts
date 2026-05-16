import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { notifyCronFailure } from "@/src/cronFailureNotify";
import { runCandleReversalAlertTick } from "@/src/candleReversal1dAlertTick";
import { runCandleReversalStatsFollowUpTick } from "@/src/candleReversalStatsTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual cron — สแกน Reversal 1D + 1H (Binance) + อัปเดตสถิติ follow-up
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  try {
    const now = Date.now();
    const scanRes = await runCandleReversalAlertTick(now, { forceScanSummary: true });
    const statsN = await runCandleReversalStatsFollowUpTick(now);
    return NextResponse.json({
      ok: true,
      notified: scanRes.notified,
      statsUpdated: statsN,
      ...(scanRes.scanSummaryText
        ? {
            reversalScanSummaryText: scanRes.scanSummaryText,
            reversalScanSummaryChars: scanRes.scanSummaryText.length,
          }
        : {}),
      at: atIso,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron reversal-scan]", e);
    await notifyCronFailure({
      scope: "reversal-scan",
      atIso,
      durationMs: Date.now() - started,
      error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
