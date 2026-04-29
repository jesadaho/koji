import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClientForCron } from "@/src/lineHandler";
import { runMarketPulseTick } from "@/src/marketPulseTick";
import { notifyCronFailure } from "@/src/cronFailureNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Market Pulse — ทุกชั่วโมง UTC (vercel.json) — เช็ค F&G + ตลาด; แจ้งเตือนเมื่อ |Δ Fear & Greed| ≥ จุด (ค่าเริ่ม 3) จากครั้งแจ้งล่าสุด
 * ผู้รับ: ผู้ติดตาม «ระบบ» เดียวกับ spot–perp basis
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  const atIso = new Date().toISOString();
  try {
    const client = createLineClientForCron();
    const r = await runMarketPulseTick(client);
    return NextResponse.json({
      ...r,
      at: atIso,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron market-pulse]", e);
    await notifyCronFailure({
      scope: "market-pulse",
      atIso,
      durationMs: Date.now() - started,
      error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
