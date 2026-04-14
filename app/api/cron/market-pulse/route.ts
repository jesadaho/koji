import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import { runMarketPulseTick } from "@/src/marketPulseTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Market Pulse — ทุก 6 ชม. UTC (vercel.json) — F&G + BTC.D + Vol% (เทียบ snapshot ~24 ชม.)
 * ผู้รับ: ผู้ติดตาม «ระบบ» เดียวกับ spot–perp basis
 * GET + Authorization: Bearer CRON_SECRET
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const started = Date.now();
  try {
    const client = createLineClient(config.lineChannelAccessToken);
    const r = await runMarketPulseTick(client);
    return NextResponse.json({
      ok: r.ok,
      ...r,
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron market-pulse]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
