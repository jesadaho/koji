import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateTmaRequest } from "@/src/telegramMiniAppAuth";
import { buildSnowballBacktestUniverse } from "@/src/snowballBacktest";

export const runtime = "nodejs";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function backtestMaxUniverse(): number {
  const v = Number(process.env.SNOWBALL_BACKTEST_MAX_UNIVERSE);
  if (Number.isFinite(v) && v >= 2 && v <= 150) return Math.floor(v);
  return 100;
}

/** GET ?total=100 — รายชื่อเหรียญสำหรับแบ่ง batch backtest */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateTmaRequest(req.headers.get("authorization"));
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const raw = req.nextUrl.searchParams.get("total");
  const n = raw != null ? Number(raw) : 22;
  if (!Number.isFinite(n) || n < 2) {
    return json({ error: "total ต้องเป็นตัวเลข ≥ 2" }, 400);
  }

  const maxUniverse = backtestMaxUniverse();
  const total = Math.min(Math.floor(n), maxUniverse);

  try {
    const symbols = await buildSnowballBacktestUniverse(total);
    return json({ symbols, total: symbols.length, maxUniverse });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
}
