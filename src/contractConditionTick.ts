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
 * แจ้ง funding เมื่อ |Δrate|×100 ≥ ค่านี้ (สเกลเดียวกับ rate×100 บนจอ)
 * ปรับได้: CONTRACT_FUNDING_MIN_DELTA_DISPLAY
 */
function minFundingChangeDisplayPct(): number {
  const raw = process.env.CONTRACT_FUNDING_MIN_DELTA_DISPLAY?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0.001;
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

function fmtFundingPct(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

function fmtTs(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

type FundingMetaLike = { fundingRate: number; collectCycle: number; nextSettleTime: number };

/** |funding ใหม่ − funding เก่า| ในหน่วย "เปอร์เซ็นต์ที่โชว์" (rate เป็น 0.0001 = 0.01%) */
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

function buildFundingMessage(
  symbol: string,
  prev: FundingSnapshotRow,
  next: FundingMetaLike
): string {
  const lines = [`🔔 Koji — เงื่อนไขสัญญาเปลี่ยน`, symbol, ``, `📌 Funding / รอบ`];
  const dPct = fundingDeltaDisplayPct(prev.fundingRate, next.fundingRate);
  const struct = fundingStructuralChanged(prev, next);
  if (fundingRateJumpSignificant(prev, next)) {
    lines.push(
      `• Funding: ${fmtFundingPct(prev.fundingRate)} → ${fmtFundingPct(next.fundingRate)} (Δ ${dPct.toFixed(2)}% pt)`
    );
  } else if (struct && dPct > 1e-12) {
    lines.push(`• Funding: ${fmtFundingPct(prev.fundingRate)} → ${fmtFundingPct(next.fundingRate)} (Δ ${dPct.toFixed(4)}% pt)`);
  }
  if (prev.collectCycle !== next.collectCycle) {
    lines.push(`• รอบชำระ (ชม.): ${prev.collectCycle} → ${next.collectCycle}`);
  }
  if (prev.nextSettleTime !== next.nextSettleTime) {
    lines.push(`• ตัดถัดไป: ${fmtTs(prev.nextSettleTime)} → ${fmtTs(next.nextSettleTime)}`);
  }
  return lines.join("\n");
}

function buildOrderMessage(symbol: string, prev: OrderSnapshotRow, next: OrderSnapshotRow): string {
  const lim = (n: number | null) => (n == null ? "—" : String(n));
  return [
    `🔔 Koji — เงื่อนไขสัญญาเปลี่ยน`,
    symbol,
    ``,
    `📌 ขนาดออเดอร์ (contract detail)`,
    `• minVol: ${prev.minVol} → ${next.minVol}`,
    `• maxVol: ${prev.maxVol} → ${next.maxVol}`,
    `• limitMaxVol: ${lim(prev.limitMaxVol)} → ${lim(next.limitMaxVol)}`,
  ].join("\n");
}

function unionPollSymbols(watchSymbols: string[], topSample: { symbol: string }[]): string[] {
  const s = new Set<string>();
  for (const x of watchSymbols) s.add(x);
  for (const r of topSample) s.add(r.symbol);
  return Array.from(s).sort();
}

/**
 * รายชั่วโมง: เทียบ funding + order limits กับ snapshot → LINE push
 */
export async function runContractConditionTick(client: Client): Promise<void> {
  const watches = await loadContractWatches();
  const systemUsers = await loadSystemChangeSubscribers();
  if (watches.length === 0 && systemUsers.length === 0) return;

  const topSample = await getFundingHistorySampleRows(50);
  const symbols = unionPollSymbols(uniqueWatchedSymbols(watches), topSample);
  if (symbols.length === 0) return;

  const now = new Date().toISOString();

  let fundingMap = await loadFundingSnapshots();
  const fundingResults = await mapPoolConcurrent(symbols, 12, async (symbol) => {
    const live = await fetchContractFunding(symbol);
    return { symbol, live };
  });

  for (const { symbol, live } of fundingResults) {
    if (!live) continue;
    const prev = fundingMap[symbol];
    if (!prev) {
      fundingMap[symbol] = {
        fundingRate: live.fundingRate,
        collectCycle: live.collectCycle,
        nextSettleTime: live.nextSettleTime,
        updatedAt: now,
      };
      continue;
    }
    if (shouldNotifyFunding(prev, live)) {
      const text = buildFundingMessage(symbol, prev, live);
      const recipients = new Set([...userIdsForSymbol(watches, symbol), ...systemUsers]);
      for (const uid of recipients) {
        try {
          await client.pushMessage(uid, [{ type: "text", text }]);
        } catch (e) {
          console.error("[contractConditionTick] push funding", symbol, uid, e);
        }
      }
    }
    fundingMap[symbol] = {
      fundingRate: live.fundingRate,
      collectCycle: live.collectCycle,
      nextSettleTime: live.nextSettleTime,
      updatedAt: now,
    };
  }
  await saveFundingSnapshots(fundingMap);

  let orderMap = await loadOrderSnapshots();
  const detailBySymbol = await fetchAllContractDetails();

  for (const symbol of symbols) {
    const d = detailBySymbol.get(symbol);
    const meta = orderMetaFromDetail(d);
    if (!meta) continue;

    const nextRow: OrderSnapshotRow = {
      minVol: meta.minVol,
      maxVol: meta.maxVol,
      limitMaxVol: meta.limitMaxVol,
      updatedAt: now,
    };
    const prev = orderMap[symbol];
    if (!prev) {
      orderMap[symbol] = nextRow;
      continue;
    }
    if (orderChanged(prev, nextRow)) {
      const text = buildOrderMessage(symbol, prev, nextRow);
      const recipients = new Set([...userIdsForSymbol(watches, symbol), ...systemUsers]);
      for (const uid of recipients) {
        try {
          await client.pushMessage(uid, [{ type: "text", text }]);
        } catch (e) {
          console.error("[contractConditionTick] push order", symbol, uid, e);
        }
      }
    }
    orderMap[symbol] = nextRow;
  }
  await saveOrderSnapshots(orderMap);
}
