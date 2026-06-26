import "server-only";

import {
  REVERSAL_CHART_AI_ANALYSIS_VERSION,
  type ReversalChartAiAnalysis,
  type ReversalChartAiExpectedPath,
  type ReversalChartAiMarketCharacter,
  type ReversalChartAiPreferredSide,
} from "@/lib/reversalChartAiAnalysis";
import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { fetchBinanceUsdmKlines } from "./binanceIndicatorKline";
import { fetchContractTickerSingle } from "./mexcMarkets";
import { resolveMexcContractFromBinanceSymbolAsync } from "./mexcContractResolver";
import {
  buildReversalSignalKlineAiPayload,
  reversalKlineAiFetchLimit,
  type ReversalSignalKlineAiPayload,
} from "./reversalSignalKlinePayload";
import { patchCandleReversalStatsAiAnalysis } from "./candleReversalStatsStore";

type OpenAiChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

export type ReversalKlineAiAnalysisResult =
  | { ok: true; analysis: ReversalChartAiAnalysis }
  | { ok: false; error: string; status?: number };

const ANALYST_PROMPT = `You are a professional crypto futures analyst.

Objective
Analyze the provided multi-timeframe kline data and signal context for a 24–48 hour trading horizon.
This analysis is NOT for long-term investing or scalping.
The result will be stored as historical statistics to evaluate whether your predictions improve trading performance.

Context
Signal timeframe: 1H
Holding period: 24–48 hours
Market: Crypto Futures
Evaluate only the next 24–48 hours after the signal.

Instructions
Focus on:
- Market structure (HH/HL, LH/LL)
- EMA trend
- Momentum
- Volume behavior
- Trend continuation vs exhaustion
- Distribution / Accumulation
- Risk of adverse move before the expected direction
- Signal context metrics (Trend Gain, Velocity, EMA20 4H Slope, ATR4H, Funding, Vol×SMA)

Do NOT explain basic candlestick patterns.

Return ONLY valid JSON.

Schema:
{
  "preferred_side": "Long | Short | Skip",
  "confidence": 0,
  "trend_strength": 0,
  "exhaustion_risk": 0,
  "distribution_risk": 0,
  "market_character": "Trend | Range | Distribution | Accumulation",
  "expected_path": "Trend Continue | Pullback then Continue | Sideway | Reversal",
  "expected_max_pullback_pct": 0,
  "reason": ""
}

Field description
preferred_side — Best direction for the next 24–48 hours.
confidence — Integer 0–100.
trend_strength — Integer 1–10.
exhaustion_risk — Integer 1–10.
distribution_risk — Integer 1–10.
market_character — Choose exactly one: Trend, Range, Distribution, Accumulation
expected_path — Choose exactly one: Trend Continue, Pullback then Continue, Sideway, Reversal
expected_max_pullback_pct — Expected maximum adverse move before the expected direction.
reason — One short sentence (maximum 20 words).

Rules
Return JSON only.
No markdown.
No additional explanation.
Base the analysis only on the provided kline data and signal context.
Prioritize probability over certainty.
If confidence is below 55, return "Skip".`;

function openAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function reversalKlineAiModel(): string {
  const m = process.env.CANDLE_REVERSAL_KLINE_AI_MODEL?.trim();
  return m && m.length <= 80 ? m : "gpt-5.5";
}

function reversalKlineAiTimeoutMs(): number {
  const n = Number(process.env.CANDLE_REVERSAL_KLINE_AI_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n >= 3000 && n <= 90000 ? Math.floor(n) : 25_000;
}

/** gpt-5 / o-series use max_completion_tokens; older chat models use max_tokens. */
function openAiChatTokenParams(
  model: string,
  limit: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  const m = model.trim().toLowerCase();
  if (/^gpt-5|^o[0-9]/.test(m)) {
    return { max_completion_tokens: limit };
  }
  return { max_tokens: limit };
}

export function isReversalKlineAiEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_KLINE_AI_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return openAiApiKey().length > 0;
}

function reversalKlineAiBackfillPerRun(): number {
  const n = Number(process.env.CANDLE_REVERSAL_KLINE_AI_BACKFILL_PER_RUN?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 5;
}

export { reversalKlineAiBackfillPerRun };

/** จำนวนแถว 1H ต่อครั้งเมื่อกดปุ่ม backfill AI ใน Mini App (admin) */
export const REVERSAL_KLINE_AI_MANUAL_BACKFILL_LIMIT = 3;

const PREFERRED_SIDES = new Set<ReversalChartAiPreferredSide>(["Long", "Short", "Skip"]);
const MARKET_CHARS = new Set<ReversalChartAiMarketCharacter>([
  "Trend",
  "Range",
  "Distribution",
  "Accumulation",
]);
const EXPECTED_PATHS = new Set<ReversalChartAiExpectedPath>([
  "Trend Continue",
  "Pullback then Continue",
  "Sideway",
  "Reversal",
]);

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function parseAnalysisJson(raw: string): ReversalChartAiAnalysis | null {
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/```[\s\S]*?```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const preferredRaw = String(o.preferred_side ?? "").trim();
  if (!PREFERRED_SIDES.has(preferredRaw as ReversalChartAiPreferredSide)) return null;

  const confidence = clampInt(Number(o.confidence), 0, 100);
  let preferred_side = preferredRaw as ReversalChartAiPreferredSide;
  if (confidence < 55) preferred_side = "Skip";

  const marketRaw = String(o.market_character ?? "").trim();
  const pathRaw = String(o.expected_path ?? "").trim();
  if (!MARKET_CHARS.has(marketRaw as ReversalChartAiMarketCharacter)) return null;
  if (!EXPECTED_PATHS.has(pathRaw as ReversalChartAiExpectedPath)) return null;

  let reason = String(o.reason ?? "").trim();
  if (!reason) return null;
  const words = wordCount(reason);
  if (words > 20) {
    reason = reason.split(/\s+/).slice(0, 20).join(" ");
  }

  const maxPullback = Number(o.expected_max_pullback_pct);
  if (!Number.isFinite(maxPullback) || maxPullback < 0) return null;

  return {
    preferred_side,
    confidence,
    trend_strength: clampInt(Number(o.trend_strength), 1, 10),
    exhaustion_risk: clampInt(Number(o.exhaustion_risk), 1, 10),
    distribution_risk: clampInt(Number(o.distribution_risk), 1, 10),
    market_character: marketRaw as ReversalChartAiMarketCharacter,
    expected_path: pathRaw as ReversalChartAiExpectedPath,
    expected_max_pullback_pct: Math.round(maxPullback * 100) / 100,
    reason,
  };
}

export async function analyzeReversalKlineWithOpenAi(
  payload: ReversalSignalKlineAiPayload,
): Promise<ReversalKlineAiAnalysisResult> {
  const key = openAiApiKey();
  if (!key) return { ok: false, error: "missing OPENAI_API_KEY" };

  const model = reversalKlineAiModel();
  const timeoutMs = reversalKlineAiTimeoutMs();
  const userContent = `${ANALYST_PROMPT}\n\nData:\n${JSON.stringify(payload)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userContent }],
        temperature: 0.25,
        ...openAiChatTokenParams(model, 400),
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      let errMsg = `openai HTTP ${res.status} (model ${model})`;
      try {
        const parsed = JSON.parse(rawText) as OpenAiChatResponse;
        if (parsed?.error?.message) errMsg = `${errMsg}: ${parsed.error.message}`;
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, error: errMsg };
    }

    const data = JSON.parse(rawText) as OpenAiChatResponse;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const analysis = parseAnalysisJson(content);
    if (!analysis) {
      return { ok: false, error: `invalid openai JSON (model ${model})` };
    }
    return { ok: true, analysis };
  } catch (e) {
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message) : String(e);
    return { ok: false, error: `openai request failed: ${msg} (model ${model})` };
  } finally {
    clearTimeout(t);
  }
}

function analysisToStatsPatch(
  analysis: ReversalChartAiAnalysis,
): Parameters<typeof patchCandleReversalStatsAiAnalysis>[1] {
  return {
    chartAiPreferredSide: analysis.preferred_side,
    chartAiConfidence: analysis.confidence,
    chartAiTrendStrength: analysis.trend_strength,
    chartAiExhaustionRisk: analysis.exhaustion_risk,
    chartAiDistributionRisk: analysis.distribution_risk,
    chartAiMarketCharacter: analysis.market_character,
    chartAiExpectedPath: analysis.expected_path,
    chartAiExpectedMaxPullbackPct: analysis.expected_max_pullback_pct,
    chartAiReason: analysis.reason,
    chartAiAnalyzedAtIso: new Date().toISOString(),
    chartAiAnalysisV: REVERSAL_CHART_AI_ANALYSIS_VERSION,
    chartAiAnalysisError: null,
  };
}

async function fetchFundingRatePct(symbol: string, mexcContract?: string | null): Promise<number | null> {
  const contract =
    mexcContract ?? (await resolveMexcContractFromBinanceSymbolAsync(symbol.trim().toUpperCase()));
  if (!contract) return null;
  try {
    const ticker = await fetchContractTickerSingle(contract);
    const fr = ticker?.fundingRate;
    if (typeof fr !== "number" || !Number.isFinite(fr)) return null;
    return Math.round(fr * 10000) / 100;
  } catch {
    return null;
  }
}

async function fetchKlinePacks(symbol: string): Promise<{
  pack15m: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>;
  pack1h: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>;
  pack4h: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>;
} | null> {
  const limit = reversalKlineAiFetchLimit();
  const sym = symbol.trim().toUpperCase();
  const [pack15m, pack1h, pack4h] = await Promise.all([
    fetchBinanceUsdmKlines(sym, "15m", limit),
    fetchBinanceUsdmKlines(sym, "1h", limit),
    fetchBinanceUsdmKlines(sym, "4h", limit),
  ]);
  if (!pack15m || !pack1h || !pack4h) return null;
  return { pack15m, pack1h, pack4h };
}

export type RunReversalKlineAiForRowInput = {
  row: Pick<
    CandleReversalStatsRow,
    | "id"
    | "symbol"
    | "tradeSide"
    | "model"
    | "signalBarOpenSec"
    | "entryPrice"
    | "retestPrice"
    | "slPrice"
    | "trendGainPct"
    | "ageOfTrendHours"
    | "ema20_4hSlopePct7d"
    | "atrPct4h"
    | "signalVolVsSma"
  >;
  mexcContract?: string | null;
  fundingRatePct?: number | null;
};

export async function runReversalKlineAiForRow(input: RunReversalKlineAiForRowInput): Promise<boolean> {
  if (!isReversalKlineAiEnabled()) return false;

  const packs = await fetchKlinePacks(input.row.symbol);
  if (!packs) {
    await patchCandleReversalStatsAiAnalysis(input.row.id, {
      chartAiAnalysisError: "kline fetch failed",
    });
    return false;
  }

  let fundingRatePct = input.fundingRatePct ?? null;
  if (fundingRatePct == null) {
    const fr = await fetchFundingRatePct(input.row.symbol, input.mexcContract);
    fundingRatePct = fr;
  }

  const payload = buildReversalSignalKlineAiPayload({
    symbol: input.row.symbol,
    tradeSide: input.row.tradeSide,
    model: input.row.model,
    signalBarOpenSec: input.row.signalBarOpenSec,
    entry: input.row.entryPrice,
    retest: input.row.retestPrice,
    sl: input.row.slPrice,
    pack15m: packs.pack15m,
    pack1h: packs.pack1h,
    pack4h: packs.pack4h,
    signalContext: {
      trendGainPct: input.row.trendGainPct,
      ageOfTrendHours: input.row.ageOfTrendHours,
      ema20_4hSlopePct7d: input.row.ema20_4hSlopePct7d,
      atrPct4h: input.row.atrPct4h,
      fundingRate: fundingRatePct != null ? fundingRatePct / 100 : null,
      signalVolVsSma: input.row.signalVolVsSma,
    },
  });

  if (!payload) {
    await patchCandleReversalStatsAiAnalysis(input.row.id, {
      chartAiAnalysisError: "kline payload build failed",
    });
    return false;
  }

  const result = await analyzeReversalKlineWithOpenAi(payload);
  if (!result.ok) {
    await patchCandleReversalStatsAiAnalysis(input.row.id, {
      chartAiAnalysisError: result.error,
    });
    return false;
  }

  await patchCandleReversalStatsAiAnalysis(input.row.id, analysisToStatsPatch(result.analysis));
  return true;
}

/** Fire-and-forget after stats append — 1H signals only. */
export function maybeRunReversalKlineAiAnalysis(input: RunReversalKlineAiForRowInput): void {
  if (!isReversalKlineAiEnabled()) return;
  void runReversalKlineAiForRow(input).catch((e) => {
    console.error("[reversalKlineAi] run failed", input.row.symbol, input.row.id, e);
  });
}

export type ReversalKlineAiBackfillSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  symbols: string[];
  errors: string[];
};

function countReversalKlineAiPending(rows: CandleReversalStatsRow[]): number {
  return rows.filter(
    (r) =>
      r.signalBarTf === "1h" && r.chartAiAnalysisV !== REVERSAL_CHART_AI_ANALYSIS_VERSION,
  ).length;
}

export async function backfillReversalKlineAiAnalysis(
  rows: CandleReversalStatsRow[],
  opts?: { limit?: number },
): Promise<ReversalKlineAiBackfillSummary> {
  const empty: ReversalKlineAiBackfillSummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    remaining: countReversalKlineAiPending(rows),
    symbols: [],
    errors: [],
  };

  if (!isReversalKlineAiEnabled()) {
    return {
      ...empty,
      errors: ["CANDLE_REVERSAL_KLINE_AI disabled or missing OPENAI_API_KEY"],
    };
  }

  const cap = opts?.limit ?? reversalKlineAiBackfillPerRun();
  const needsAi = rows
    .filter(
      (r) =>
        r.signalBarTf === "1h" && r.chartAiAnalysisV !== REVERSAL_CHART_AI_ANALYSIS_VERSION,
    )
    .sort((a, b) => b.alertedAtMs - a.alertedAtMs);

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const symbols: string[] = [];
  const failedRows: { symbol: string; id: string }[] = [];

  for (const row of needsAi) {
    if (attempted >= cap) break;
    attempted += 1;
    const ok = await runReversalKlineAiForRow({ row });
    if (ok) {
      succeeded += 1;
      symbols.push(row.symbol);
    } else {
      failed += 1;
      failedRows.push({ symbol: row.symbol, id: row.id });
    }
  }

  const errors: string[] = [];
  let remaining = Math.max(0, needsAi.length - succeeded);
  try {
    const { loadCandleReversalStatsState } = await import("./candleReversalStatsStore");
    const fresh = await loadCandleReversalStatsState();
    remaining = countReversalKlineAiPending(fresh.rows);
    for (const f of failedRows) {
      const errRow = fresh.rows.find((r) => r.id === f.id);
      errors.push(`${f.symbol}: ${errRow?.chartAiAnalysisError?.trim() || "analysis failed"}`);
    }
  } catch {
    for (const f of failedRows) {
      errors.push(`${f.symbol}: analysis failed`);
    }
  }

  return { attempted, succeeded, failed, remaining, symbols, errors };
}
