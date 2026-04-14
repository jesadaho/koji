import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import { runPctStepTrailingPriceAlertTick } from "@/src/pctStepPriceAlertTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron ~5 นาที — เตือน% trailing เท่านั้น
 * แจ้งเตือน spot–perp basis (ราคาผิดปกติ) → /api/cron/price-sync ทุก ~15 นาที
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  try {
    const client = createLineClient(config.lineChannelAccessToken);
    const r = await runPctStepTrailingPriceAlertTick(client);
    return NextResponse.json({
      ok: true,
      scope: "trailing",
      notified: r.notified,
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron pct-trailing]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
