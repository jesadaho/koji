import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import { runSnowballPublicScanTick } from "@/src/indicatorAlertWorker";
import { notifyCronFailure } from "@/src/cronFailureNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Snowball 4h — cron หลักหลังปิดแท่ง (vercel.json: 10 0,4,8,12,16,20 * * * UTC ≈ +10 นาทีหลังปิด 4h — หลีก price-sync ที่ :00/:15)
 * รันเฉพาะ public Snowball (Binance) ตาม TF env + สรุปสแกน 4h (เข้ากลุ่มเมื่อเปิด env; ข้อความเต็มใน JSON `snowballScanSummaryText`)
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
    let r = await runSnowballPublicScanTick(client);
    const lockBusy =
      typeof r.scanSkippedReason === "string" &&
      r.scanSkippedReason.includes("feed lock");
    if (lockBusy) {
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      r = await runSnowballPublicScanTick(client);
    }
    return NextResponse.json({
      ok: true,
      notified: r.notified,
      detail: r.detail,
      ...(r.scanSkippedReason ? { scanSkippedReason: r.scanSkippedReason } : {}),
      ...(r.snowballScanSummaryText
        ? {
            snowballScanSummaryText: r.snowballScanSummaryText,
            snowballScanSummaryChars: r.snowballScanSummaryText.length,
          }
        : {}),
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
