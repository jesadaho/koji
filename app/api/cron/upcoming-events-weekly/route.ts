import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { runUpcomingEventsWeeklyDigest } from "@/src/upcomingEventsTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Weekly outlook — จันทร์ 00:00 UTC ≈ 07:00 น. ไทย (vercel.json)
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  try {
    const r = await runUpcomingEventsWeeklyDigest(started);
    return NextResponse.json({
      ...r,
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron upcoming-events-weekly]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
