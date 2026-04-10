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
  type MexcDetailRow,
} from "./mexcContractMeta";
import { formatFunding, fundingRateLineEmoji, maxVolContractWarnThreshold } from "./marketsFormat";
import { sendAlertNotification } from "./alertNotify";

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

type FundingMetaLike = { fundingRate: number; collectCycle: number; nextSettleTime: number };

function fundingDeltaDisplayPct(prev: number, next: number): number {
  return Math.abs(prev - next) * 100;
}

function fundingCycleChanged(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  return prev.collectCycle !== next.collectCycle;
}

function fundingRateJumpSignificant(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  return fundingDeltaDisplayPct(prev.fundingRate, next.fundingRate) >= minFundingChangeDisplayPct();
}

/** แจ้งเมื่อรอบชำระ (ชม.) เปลี่ยน หรือ funding rate ขยับถึงเกณฑ์ — ไม่แจ้งเมื่อมีแค่ nextSettleTime เปลี่ยน */
function shouldNotifyFunding(prev: FundingSnapshotRow, next: FundingMetaLike): boolean {
  if (fundingCycleChanged(prev, next)) return true;
  return fundingRateJumpSignificant(prev, next);
}

/** แจ้งเตือนเฉพาะ max order size; snapshot ยังอัปเดต min/limit ตาม API */
function shouldNotifyOrderMaxVol(prev: OrderSnapshotRow, next: OrderSnapshotRow): boolean {
  return prev.maxVol !== next.maxVol;
}

function peerMaxVolThresholdFromDetails(detailBySymbol: Map<string, MexcDetailRow>): number | null {
  const vols: number[] = [];
  detailBySymbol.forEach((row) => {
    const v = row.maxVol;
    if (typeof v === "number" && !Number.isNaN(v) && v > 0) vols.push(v);
  });
  return maxVolContractWarnThreshold(vols);
}

/** แยกบล็อกข้อความ: 📦 สภาพคล่อง / 💹 ต้นทุนถือสถานะ / 🕒 รอบจ่าย (เมื่อช่วงชำระเปลี่ยน) */
function buildMexcSystemConditionMessage(
  symbol: string,
  funding: { prev: FundingSnapshotRow; next: FundingMetaLike } | null,
  order: { prev: OrderSnapshotRow; next: OrderSnapshotRow } | null,
  peerMaxVolThreshold: number | null
): string {
  const lines: string[] = [`🔔 [MEXC System Condition Change]`, `🪙 Symbol: ${displaySymbol(symbol)}`];

  if (order) {
    const summary = `${formatContractVol(order.prev.maxVol)} → ${formatContractVol(order.next.maxVol)}`;
    const lowLiquidity =
      peerMaxVolThreshold != null &&
      order.next.maxVol > 0 &&
      order.next.maxVol <= peerMaxVolThreshold;
    const head = lowLiquidity ? "⚠️ ขนาดออเดอร์สูงสุด (Max order)" : "📦 ขนาดออเดอร์สูงสุด (Max order)";
    lines.push("", head, `   ${summary}`);
    if (lowLiquidity) {
      lines.push("   (สภาพคล่องต่ำเทียบสัญญาอื่น — ระวังไม้ใหญ่/ส่งคำสั่งยาก)");
    }
  }

  if (funding) {
    const heat = fundingRateLineEmoji(funding.next.fundingRate);
    const rateStr = `${formatFunding(funding.prev.fundingRate)} → ${formatFunding(funding.next.fundingRate)}`;
    lines.push("", `💹 อัตรา Funding ${heat}`, `   ${rateStr}`);

    /** รอบจ่าย (ชม. ต่อรอบ) — แสดงทุกครั้ง · ถ้ารอบเปลี่ยนจะโชว์ a→b · ไม่ใส่เวลาตัดรอบถัดไป */
    const cycleChanged = funding.prev.collectCycle !== funding.next.collectCycle;
    lines.push("", `🕒 รอบจ่าย (cycle)`);
    lines.push(
      cycleChanged
        ? `   ${funding.prev.collectCycle}h → ${funding.next.collectCycle}h`
        : `   ${funding.next.collectCycle}h`,
    );
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

/** LINE text สูงสุด 5000 — ตัดก้อนเผื่อหัวข้อรวม */
const LINE_TEXT_CHUNK_SAFE = 4500;

function chunkLineTextBody(full: string, maxLen: number): string[] {
  if (full.length <= maxLen) return [full];
  const out: string[] = [];
  for (let i = 0; i < full.length; i += maxLen) {
    out.push(full.slice(i, i + maxLen));
  }
  return out;
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

  const peerMaxVolThreshold = peerMaxVolThresholdFromDetails(detailBySymbol);

  let fundingMap = await loadFundingSnapshots();
  let orderMap = await loadOrderSnapshots();

  function recipientsFor(symbol: string): Set<string> {
    return new Set([...userIdsForSymbol(watches, symbol), ...systemUsers]);
  }

  /** รวมหลายสัญญา → push น้อยครั้งต่อ user (ลด LINE 429) */
  const pendingByUser = new Map<string, string[]>();

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
        notifyO = shouldNotifyOrderMaxVol(prevO, nextRow);
      }
    }

    if (notifyF || notifyO) {
      const fundingBlock =
        notifyF && live && prevF ? { prev: prevF, next: live } : null;
      const orderBlock = notifyO && prevO && nextRow ? { prev: prevO, next: nextRow } : null;
      const text = buildMexcSystemConditionMessage(symbol, fundingBlock, orderBlock, peerMaxVolThreshold);
      for (const uid of Array.from(recipientsFor(symbol))) {
        const list = pendingByUser.get(uid) ?? [];
        list.push(text);
        pendingByUser.set(uid, list);
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

  const sep = "\n\n────────\n\n";
  for (const [uid, parts] of Array.from(pendingByUser.entries())) {
    if (parts.length === 0) continue;
    const digest =
      parts.length > 1
        ? `🔔 [MEXC System] สรุป ${parts.length} สัญญา (รอบเดียวกัน)\n\n`
        : "";
    const joined = digest + parts.join(sep);
    const blobs = chunkLineTextBody(joined, LINE_TEXT_CHUNK_SAFE);
    for (let bi = 0; bi < blobs.length; bi++) {
      const suffix = blobs.length > 1 ? `\n\n( ${bi + 1}/${blobs.length} )` : "";
      const body = `${blobs[bi]!}${suffix}`;
      try {
        await sendAlertNotification(client, uid, body);
      } catch (e) {
        console.error("[contractConditionTick] push batched system condition", uid, bi, e);
      }
    }
  }

  await saveFundingSnapshots(fundingMap);
  await saveOrderSnapshots(orderMap);
}
