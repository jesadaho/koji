import { NextResponse } from "next/server";
import { getFundingHistoryForSymbol } from "@/src/fundingHistoryStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOL_RE = /^[A-Za-z0-9]+_USDT$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbol")?.trim() ?? "";
  if (!SYMBOL_RE.test(raw)) {
    return NextResponse.json({ error: "ระบุ symbol เช่น BTC_USDT" }, { status: 400 });
  }
  const points = await getFundingHistoryForSymbol(raw);
  return NextResponse.json({ symbol: raw, points });
}
