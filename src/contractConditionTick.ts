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
import {
  fetchAllContractDetails,
  fetchContractFunding,
  orderMetaFromDetail,
} from "./mexcContractMeta";

/** แจ้ง funding เฉพาะเมื่อ |Δ| ตามที่โชว์เป็น % ≥ ค่านี้ (จุดล่าสุด = snapshot รอบก่อน) */
const MIN_FUNDING_CHANGE_DISPLAY_PCT = 0.1;

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
  return fundingDeltaDisplayPct(prev.fundingRate, next.fundingRate) >= MIN_FUNDING_CHANGE_DISPLAY_PCT;
}

/** แจ้งเมื่อรอบ/เวลาตัดเปลี่ยน หรือ funding ขยับ ≥ 0.1% pt จาก snapshot ล่าสุด */
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

/**
 * รายชั่วโมง: เทียบ funding + order limits กับ snapshot → LINE push
 */
export async function runContractConditionTick(client: Client): Promise<void> {
  const watches = await loadContractWatches();
  if (watches.length === 0) return;

  const symbols = uniqueWatchedSymbols(watches);
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
      for (const uid of userIdsForSymbol(watches, symbol)) {
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
      for (const uid of userIdsForSymbol(watches, symbol)) {
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
