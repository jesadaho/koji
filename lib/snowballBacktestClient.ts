import type { SnowballStatsApiPayload, SnowballStatsRow } from "@/lib/snowballStatsClient";
import { getTelegramInitData } from "@/lib/kojiTelegramWebApp";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export type SnowballBacktestRequest = {
  startDate: string;
  endDate: string;
  topAlts?: number;
  symbols?: string[];
};

export type SnowballBacktestMeta = {
  startDate: string;
  endDate: string;
  symbols: string[];
  signalCount: number;
  elapsedMs: number;
};

export type SnowballBacktestApiPayload = Pick<
  SnowballStatsApiPayload,
  "rows" | "viewerTpSlPlanSummary" | "viewerTpSlPlan" | "viewerStrategyMarginUsdt" | "viewerStrategyLeverage"
> & {
  meta: SnowballBacktestMeta;
};

export class SnowballBacktestApiError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(message: string, status: number, bodyText: string) {
    super(message);
    this.name = "SnowballBacktestApiError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

function messageFromParsed(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
    return String((parsed as { error: unknown }).error);
  }
  return fallback;
}

/** POST /api/tma/snowball-backtest — รัน detect ย้อนหลัง sync */
export async function fetchSnowballBacktest(
  body: SnowballBacktestRequest,
  initData?: string | null,
): Promise<SnowballBacktestApiPayload> {
  const auth = initData ?? getTelegramInitData();
  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(auth ? { Authorization: `tma ${auth}` } : {}),
  };
  const url = `${apiBase}/api/tma/snowball-backtest`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    throw new SnowballBacktestApiError(messageFromParsed(parsed, res.statusText), res.status, text);
  }
  return parsed as SnowballBacktestApiPayload;
}

export function isSnowballBacktestRow(row: SnowballStatsRow): boolean {
  return row.source === "backtest";
}
