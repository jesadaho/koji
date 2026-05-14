import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import { runSnowballPublicScanTick } from "@/src/indicatorAlertWorker";
import { notifyCronFailure } from "@/src/cronFailureNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual / extra cron — รันเฉพาะ public Snowball (Binance) ตาม TF env + สรุปสแกน 4h ถ้าเปิด
 * ไม่รัน RSI/EMA/Div ของ public feed, ไม่รัน price-sync อื่น ๆ
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  try {
    const client = createLineClientForCron();
    const r = await runSnowballPublicScanTick(client);
    return NextResponse.json({
      ok: true,
      notified: r.notified,
      detail: r.detail,
      at: atIso,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron snowball-scan]", e);
    await notifyCronFailure({
      scope: "snowball-scan",
      atIso,
      durationMs: Date.now() - started,
      error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
