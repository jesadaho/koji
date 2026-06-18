import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SnowballBacktestApiPayload } from "@/lib/snowballBacktestClient";
import {
  resolveViewerStatsTpSlPlan,
  resolveViewerStatsTradeSizing,
  viewerStatsTpSlPlanPayload,
  viewerStatsTpSlPlanSummary,
} from "@/lib/statsTpSlPlanForUser";
import {
  enrichSnowballStatsWithViewerStrategyProfit,
  withViewerStrategyProfitDisplayFields,
} from "@/src/statsStrategyProfitEnrich";
import { authenticateTmaRequest } from "@/src/telegramMiniAppAuth";
import { runSnowballBacktest } from "@/src/snowballBacktest";

export const maxDuration = 300;
export const runtime = "nodejs";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function backtestMaxSymbols(): number {
  const v = Number(process.env.SNOWBALL_BACKTEST_MAX_SYMBOLS);
  if (Number.isFinite(v) && v >= 1 && v <= 50) return Math.floor(v);
  return 20;
}

function backtestMaxDays(): number {
  const v = Number(process.env.SNOWBALL_BACKTEST_MAX_DAYS);
  if (Number.isFinite(v) && v >= 1 && v <= 365) return Math.floor(v);
  return 60;
}

function parseDateMs(raw: unknown, endOfDay: boolean): number | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const ms = Date.parse(`${raw.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateTmaRequest(req.headers.get("authorization"));
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ error: "invalid_body" }, 400);
  }

  const b = body as Record<string, unknown>;
  const startMs = parseDateMs(b.startDate, false);
  const endMs = parseDateMs(b.endDate, true);
  if (startMs == null || endMs == null) {
    return json({ error: "startDate/endDate ต้องเป็น YYYY-MM-DD" }, 400);
  }
  if (endMs <= startMs) {
    return json({ error: "endDate ต้องหลัง startDate" }, 400);
  }

  const maxDays = backtestMaxDays();
  const rangeDays = (endMs - startMs) / (24 * 3600 * 1000);
  if (rangeDays > maxDays) {
    return json({ error: `ช่วงย้อนหลังเกิน ${maxDays} วัน` }, 400);
  }

  const maxSymbols = backtestMaxSymbols();
  let topAlts: number | undefined;
  if (b.topAlts != null) {
    const n = Number(b.topAlts);
    if (!Number.isFinite(n) || n < 0) return json({ error: "topAlts ไม่ถูกต้อง" }, 400);
    topAlts = Math.floor(n);
  }

  let symbols: string[] | undefined;
  if (Array.isArray(b.symbols)) {
    symbols = b.symbols
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (symbols.length > maxSymbols) {
      return json({ error: `symbols เกิน ${maxSymbols} เหรียญ` }, 400);
    }
  }

  const t0 = Date.now();
  try {
    const result = await runSnowballBacktest({
      startMs,
      endMs,
      topAlts,
      symbols,
      maxSymbols,
    });

    const [plan, sizing] = await Promise.all([
      resolveViewerStatsTpSlPlan(auth.telegramUserId, "snowball"),
      resolveViewerStatsTradeSizing(auth.telegramUserId, "snowball"),
    ]);

    const rows = [...result.rows];
    await enrichSnowballStatsWithViewerStrategyProfit(rows, plan);
    const displayRows = rows.map((r) => withViewerStrategyProfitDisplayFields(r, plan));

    const payload: SnowballBacktestApiPayload = {
      rows: displayRows,
      meta: {
        startDate: String(b.startDate).trim(),
        endDate: String(b.endDate).trim(),
        symbols: result.symbols,
        signalCount: result.signalCount,
        elapsedMs: Date.now() - t0,
      },
      viewerTpSlPlanSummary: viewerStatsTpSlPlanSummary(plan),
      viewerTpSlPlan: viewerStatsTpSlPlanPayload(plan),
      viewerStrategyMarginUsdt: sizing.marginUsdt,
      viewerStrategyLeverage: sizing.leverage,
    };

    return json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
}
