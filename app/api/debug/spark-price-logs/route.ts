import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { loadPriceSpike15mAlertState } from "@/src/priceSpike15mAlertStateStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asPositiveInt(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function fmtBkk(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} (BKK)`;
}

/**
 * Debug: ดู price logs (priceSamples) ที่ Spark เก็บไว้ต่อเหรียญ
 * GET /api/debug/spark-price-logs?symbol=BSB_USDT&lookbackSec=3600
 *
 * Production ต้องใส่ Authorization: Bearer $CRON_SECRET (ใช้ helper เดียวกับ cron)
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const symbolRaw = searchParams.get("symbol")?.trim();
  if (!symbolRaw) {
    return NextResponse.json(
      { error: "missing symbol", example: "/api/debug/spark-price-logs?symbol=BSB_USDT" },
      { status: 400 }
    );
  }
  const symbol = symbolRaw.toUpperCase();
  const lookbackSec = asPositiveInt(searchParams.get("lookbackSec")) ?? 3600;

  const state = await loadPriceSpike15mAlertState();
  const row = state[symbol];
  if (!row) {
    return NextResponse.json(
      {
        ok: false,
        symbol,
        error: "no state for symbol (ยังไม่ถูก sample ในรอบ cron หรือไม่ได้อยู่ใน universe/topN ตอนนั้น)",
      },
      { status: 404 }
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const minTs = nowSec - lookbackSec;
  const samples = (row.priceSamples ?? [])
    .filter((s) => Number.isFinite(s.tsSec) && s.tsSec >= minTs)
    .sort((a, b) => a.tsSec - b.tsSec)
    .map((s) => ({
      tsSec: s.tsSec,
      timeBkk: fmtBkk(s.tsSec),
      lastPrice: s.lastPrice,
    }));

  return NextResponse.json({
    ok: true,
    symbol,
    lookbackSec,
    checkpoint: {
      tsSec: row.checkpointSec,
      timeBkk: fmtBkk(row.checkpointSec),
      price: row.checkpointPrice,
    },
    samplesCount: samples.length,
    samples,
  });
}

