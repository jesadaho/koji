import type { Client } from "@line/bot-sdk";
import {
  loadContractWatches,
  loadFundingSnapshots,
  loadOrderSnapshots,
  saveFundingSnapshots,
  saveOrderSnapshots,
  userIdsForSymbol,
  uniqueWatchedSymbols,
  type FundingSnapshotRow,
  type OrderSnapshotRow,
} from "./contractWatchStore";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
import { getFundingHistorySampleRows } from "./mexcMarkets";
import {
  fetchAllContractDetails,
  fetchContractFunding,
  orderMetaFromDetail,
} from "./mexcContractMeta";

/**
 * แจ้ง funding เมื่อ |Δrate|×100 ≥ ค่านี้ (หน่วยเดียวกับความต่างของ % ที่โชว์ Markets)
 * ค่าเริ่ม 0.1 = ต้องขยับอย่างน้อย 0.1% pt (เช่น 0.01% → 0.11%) ถึงจะแจ้ง — ปรับได้ที่ CONTRACT_FUNDING_MIN_DELTA_DISPLAY
 */
function minFundingChangeDisplayPct(): number {
  const raw = process.env.CONTRACT_FUNDING_MIN_DELTA_DISPLAY?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0.1;
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

/** แสดงใน LINE ให้ใกล้เคียงที่ผู้ใช้ระบุ (ทศนิยม 2 ตำแหน่ง) */
function fmtFundingPctShort(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function fmtTs(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

function displaySymbol(mexcSymbol: string): string {
  const s = mexcSymbol.trim();
  const base = s.replace(/_USDT$/i, "");
  return `$${base}/USDT`;
}

/** โวลุ่มสัญญาแบบอ่านง่าย (1M, 500K) */
function formatContractVol(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function orderChangeSummaryLine(prev: OrderSnapshotRow, next: OrderSnapshotRow): string {
  const parts: string[] = [];
  if (prev.maxVol !== next.maxVol) {
    parts.push(`Max order size ${formatContractVol(prev.maxVol)} → ${formatContractVol(next.maxVol)}`);
  }
  if (prev.minVol !== next.minVol) {
    parts.push(`Min vol ${formatContractVol(prev.minVol)} → ${formatContractVol(next.minVol)}`);
  }
  if (prev.limitMaxVol !== next.limitMaxVol) {
    const a = prev.limitMaxVol == null ? "—" : formatContractVol(prev.limitMaxVol);
    const b = next.limitMaxVol == null ? "—" : formatContractVol(next.limitMaxVol);
    parts.push(`Limit max vol ${a} → ${b}`);
  }
  return parts.join(" · ");
}

type FundingMetaLike = { fundingRate: number; collectCycle: number; nextSettleTime: number };

function fundingDeltaDisplayPct(prev: number, next: number): number {
  return Math.abs(prev - next) * 100;
}

function fundingStructuralChanged(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  return prev.collectCycle !== next.collectCycle || prev.nextSettleTime !== next.nextSettleTime;
}

function fundingRateJumpSignificant(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  return fundingDeltaDisplayPct(prev.fundingRate, next.fundingRate) >= minFundingChangeDisplayPct();
}

/** แจ้งเมื่อรอบ/เวลาตัดเปลี่ยน หรือ funding ขยับถึงเกณฑ์จาก snapshot ล่าสุด */
function shouldNotifyFunding(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  if (fundingStructuralChanged(prev, next)) return true;
  return fundingRateJumpSignificant(prev, next);
}

function orderChanged(prev: OrderSnapshotRow, next: OrderSnapshotRow): boolean {
  return (
    prev.minVol !== next.minVol ||
    prev.maxVol !== next.maxVol ||
    prev.limitMaxVol !== next.limitMaxVol
  );
}

function buildFundingBodyLine(prev: FundingSnapshotRow, next: FundingMetaLike): string {
  const a = fmtFundingPctShort(prev.fundingRate);
  const b = fmtFundingPctShort(next.fundingRate);
  const extras: string[] = [];
  if (prev.collectCycle !== next.collectCycle) {
    extras.push(`รอบ ${prev.collectCycle}h → ${next.collectCycle}h`);
  }
  if (prev.nextSettleTime !== next.nextSettleTime) {
    extras.push(`ตัด ${fmtTs(prev.nextSettleTime)} → ${fmtTs(next.nextSettleTime)}`);
  }
  if (extras.length === 0) return `${a} → ${b}`;
  return `${a} → ${b} (${extras.join(" · ")})`;
}

function buildMexcSystemConditionMessage(
  symbol: string,
  funding: { prev: FundingSnapshotRow; next: FundingMetaLike } | null,
  order: { prev: OrderSnapshotRow; next: OrderSnapshotRow } | null
): string {
  const lines = [`🔔 [MEXC System Condition Change]`, `🪙 Symbol: ${displaySymbol(symbol)}`];
  if (order) {
    lines.push(`🛠 Change: ${orderChangeSummaryLine(order.prev, order.next)}`);
  }
  if (funding) {
    lines.push(`📉 Funding: ${buildFundingBodyLine(funding.prev, funding.next)}`);
  }
  return lines.join("\n");
}

/** เมื่อดึง Top 50 ไม่ได้แต่มีคนติดตามระบบ — ยัง poll อย่างน้อยเพื่อไม่ให้ cron เงียบทั้งก้อน */
const FALLBACK_POLL_SYMBOLS = ["BTC_USDT", "ETH_USDT", "SOL_USDT"] as const;

function unionPollSymbols(watchSymbols: string[], topSample: { symbol: string }[]): string[] {
  const s = new Set<string>();
  for (const x of watchSymbols) s.add(x);
  for (const r of topSample) s.add(r.symbol);
  return Array.from(s).sort();
}

/**
 * รายชั่วโมง: เทียบ funding + order limits กับ snapshot → LINE push (รวมเป็นข้อความเดียวถ้าทั้งคู่เปลี่ยน)
 */
export async function runContractConditionTick(client: Client): Promise<void> {
  const watches = await loadContractWatches();
  const systemUsers = await loadSystemChangeSubscribers();
  if (watches.length === 0 && systemUsers.length === 0) return;

  const topSample = await getFundingHistorySampleRows(50);
  let symbols = unionPollSymbols(uniqueWatchedSymbols(watches), topSample);
  if (symbols.length === 0 && systemUsers.length > 0) {
    console.error(
      "[contractConditionTick] getFundingHistorySampleRows returned no symbols but system subscribers exist — using fallback",
    );
    symbols = Array.from(FALLBACK_POLL_SYMBOLS);
  }
  if (symbols.length === 0) return;

  const now = new Date().toISOString();

  const [fundingResults, detailBySymbol] = await Promise.all([
    mapPoolConcurrent(symbols, 12, async (symbol) => {
      const live = await fetchContractFunding(symbol);
      return { symbol, live };
    }),
    fetchAllContractDetails(),
  ]);

  const liveBySymbol = new Map<string, FundingMetaLike | null>();
  for (const { symbol, live } of fundingResults) {
    liveBySymbol.set(symbol, live);
  }

  let fundingMap = await loadFundingSnapshots();
  let orderMap = await loadOrderSnapshots();

  function recipientsFor(symbol: string): Set<string> {
    return new Set([...userIdsForSymbol(watches, symbol), ...systemUsers]);
  }

  for (const symbol of symbols) {
    const live = liveBySymbol.get(symbol) ?? null;
    const prevF = fundingMap[symbol];

    let notifyF = false;
    if (live && prevF) {
      notifyF = shouldNotifyFunding(prevF, live);
    }

    const d = detailBySymbol.get(symbol);
    const meta = orderMetaFromDetail(d);
    const prevO = orderMap[symbol];
    let nextRow: OrderSnapshotRow | null = null;
    let notifyO = false;
    if (meta) {
      nextRow = {
        minVol: meta.minVol,
        maxVol: meta.maxVol,
        limitMaxVol: meta.limitMaxVol,
        updatedAt: now,
      };
      if (prevO) {
        notifyO = orderChanged(prevO, nextRow);
      }
    }

    if (notifyF || notifyO) {
      const fundingBlock =
        notifyF && live && prevF ? { prev: prevF, next: live } : null;
      const orderBlock = notifyO && prevO && nextRow ? { prev: prevO, next: nextRow } : null;
      const text = buildMexcSystemConditionMessage(symbol, fundingBlock, orderBlock);
      for (const uid of Array.from(recipientsFor(symbol))) {
        try {
          await client.pushMessage(uid, [{ type: "text", text }]);
        } catch (e) {
          console.error("[contractConditionTick] push system condition", symbol, uid, e);
        }
      }
    }

    if (live) {
      fundingMap[symbol] = {
        fundingRate: live.fundingRate,
        collectCycle: live.collectCycle,
        nextSettleTime: live.nextSettleTime,
        updatedAt: now,
      };
    }

    if (meta && nextRow) {
      orderMap[symbol] = nextRow;
    }
  }

  await saveFundingSnapshots(fundingMap);
  await saveOrderSnapshots(orderMap);
}
