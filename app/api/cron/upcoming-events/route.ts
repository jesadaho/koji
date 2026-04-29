import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import { runUpcomingEventsAlertsTick } from "@/src/upcomingEventsTick";
import { runUsMarketSessionAlerts } from "@/src/usMarketSessionAlert";
import { notifyCronFailure } from "@/src/cronFailureNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pre-event + live result + อัปเดต snapshot — ทุก ~5 นาที (vercel.json)
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  try {
    const lineClient = createLineClientForCron();
    const session = await runUsMarketSessionAlerts(lineClient, started);
    const r = await runUpcomingEventsAlertsTick(started);
    return NextResponse.json({
      ...r,
      sessionSent: session.sent,
      sessionSkipped: session.skipped,
      at: atIso,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron upcoming-events]", e);
    await notifyCronFailure({
      scope: "upcoming-events",
      atIso,
      durationMs: Date.now() - started,
      error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
