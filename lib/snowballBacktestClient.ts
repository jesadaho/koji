import type { SnowballStatsApiPayload, SnowballStatsRow } from "@/lib/snowballStatsClient";
import { getTelegramInitData } from "@/lib/kojiTelegramWebApp";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export const SNOWBALL_BACKTEST_BATCH_SIZE = 20;

export const SNOWBALL_BACKTEST_UNIVERSE_OPTIONS = [20, 40, 60, 80, 100] as const;

export type SnowballBacktestUniverseSize = (typeof SNOWBALL_BACKTEST_UNIVERSE_OPTIONS)[number];

export const SNOWBALL_BACKTEST_BATCH_DELAY_SEC_OPTIONS = [0, 30, 60, 120] as const;

export type SnowballBacktestBatchDelaySec = (typeof SNOWBALL_BACKTEST_BATCH_DELAY_SEC_OPTIONS)[number];

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
  /** จำนวน batch ที่รัน (1 = รอบเดียว) */
  batchCount?: number;
  batchSize?: number;
  batchDelaySec?: number;
};

export type SnowballBacktestApiPayload = Pick<
  SnowballStatsApiPayload,
  "rows" | "viewerTpSlPlanSummary" | "viewerTpSlPlan" | "viewerStrategyMarginUsdt" | "viewerStrategyLeverage"
> & {
  meta: SnowballBacktestMeta;
};

export type SnowballBacktestBatchProgress = {
  batchIndex: number;
  batchCount: number;
  symbols: string[];
  phase: "running" | "waiting";
  waitSecRemaining?: number;
  signalsSoFar: number;
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

function authHeaders(initData?: string | null): HeadersInit {
  const auth = initData ?? getTelegramInitData();
  return {
    Accept: "application/json",
    ...(auth ? { Authorization: `tma ${auth}` } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function snowballBacktestRowDedupeKey(
  row: Pick<SnowballStatsRow, "symbol" | "alertSide" | "triggerKind" | "signalBarOpenSec">,
): string {
  const sym = row.symbol.trim().toUpperCase();
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  return `${sym}|${side}|${row.signalBarOpenSec}`;
}

export function mergeSnowballBacktestRows(
  existing: SnowballStatsRow[],
  incoming: SnowballStatsRow[],
): SnowballStatsRow[] {
  const seen = new Set(existing.map((r) => snowballBacktestRowDedupeKey(r)));
  const out = [...existing];
  for (const row of incoming) {
    const key = snowballBacktestRowDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function chunkSymbols(symbols: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

/** GET /api/tma/snowball-backtest/symbols — universe สำหรับแบ่ง batch */
export async function fetchSnowballBacktestUniverse(
  total: number,
  initData?: string | null,
): Promise<string[]> {
  const url = `${apiBase}/api/tma/snowball-backtest/symbols?total=${encodeURIComponent(String(total))}`;
  const res = await fetch(url, { headers: authHeaders(initData) });
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
  const symbols = (parsed as { symbols?: unknown })?.symbols;
  if (!Array.isArray(symbols)) {
    throw new SnowballBacktestApiError("invalid universe response", res.status, text);
  }
  return symbols.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/** POST /api/tma/snowball-backtest — รัน detect ย้อนหลัง sync */
export async function fetchSnowballBacktest(
  body: SnowballBacktestRequest,
  initData?: string | null,
): Promise<SnowballBacktestApiPayload> {
  const headers: HeadersInit = {
    ...authHeaders(initData),
    "Content-Type": "application/json",
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

export type RunSnowballBacktestBatchedOpts = {
  startDate: string;
  endDate: string;
  totalSymbols: number;
  batchSize?: number;
  batchDelaySec?: number;
  onProgress?: (p: SnowballBacktestBatchProgress) => void;
  initData?: string | null;
};

/** รัน backtest แบ่ง batch — ดึง universe แล้ว POST ทีละกลุ่ม พร้อม delay ระหว่างรอบ */
export async function runSnowballBacktestBatched(
  opts: RunSnowballBacktestBatchedOpts,
): Promise<SnowballBacktestApiPayload> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? SNOWBALL_BACKTEST_BATCH_SIZE));
  const batchDelaySec = Math.max(0, Math.floor(opts.batchDelaySec ?? 0));
  const t0 = Date.now();

  const universe = await fetchSnowballBacktestUniverse(opts.totalSymbols, opts.initData);
  const batches = chunkSymbols(universe, batchSize);
  if (batches.length === 0) {
    throw new SnowballBacktestApiError("ไม่มีเหรียญใน universe", 400, "");
  }

  let mergedRows: SnowballStatsRow[] = [];
  let lastPayload: SnowballBacktestApiPayload | null = null;
  const allSymbols: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const symbols = batches[i]!;
    allSymbols.push(...symbols);

    opts.onProgress?.({
      batchIndex: i + 1,
      batchCount: batches.length,
      symbols,
      phase: "running",
      signalsSoFar: mergedRows.length,
    });

    const data = await fetchSnowballBacktest(
      { startDate: opts.startDate, endDate: opts.endDate, symbols },
      opts.initData,
    );
    lastPayload = data;
    mergedRows = mergeSnowballBacktestRows(mergedRows, data.rows);

    const isLast = i === batches.length - 1;
    if (!isLast && batchDelaySec > 0) {
      for (let sec = batchDelaySec; sec > 0; sec--) {
        opts.onProgress?.({
          batchIndex: i + 1,
          batchCount: batches.length,
          symbols: batches[i + 1] ?? [],
          phase: "waiting",
          waitSecRemaining: sec,
          signalsSoFar: mergedRows.length,
        });
        await sleep(1000);
      }
    }
  }

  if (!lastPayload) {
    throw new SnowballBacktestApiError("backtest ไม่สำเร็จ", 500, "");
  }

  return {
    ...lastPayload,
    rows: mergedRows,
    meta: {
      ...lastPayload.meta,
      startDate: opts.startDate,
      endDate: opts.endDate,
      symbols: [...new Set(allSymbols)],
      signalCount: mergedRows.length,
      elapsedMs: Date.now() - t0,
      batchCount: batches.length,
      batchSize,
      batchDelaySec,
    },
  };
}

export function isSnowballBacktestRow(row: SnowballStatsRow): boolean {
  return row.source === "backtest";
}
