import {
  fetchBinanceUsdmKlines,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceIndicatorTf,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import { sendPublicSnowballFeedToSparkGroup } from "./alertNotify";
import { runSnowballAutoTradeAfterSnowballAlert } from "./snowballAutoTradeExecutor";
import {
  isPublicSnowballTripleCheckEnabled,
  snowballConfirmBarEnabled,
  snowballConfirmMaxAgeHours,
  snowballConfirmVolMinRatio,
  snowballDoubleBarrierEnabled,
} from "./publicIndicatorFeed";
import {
  loadSnowballPendingConfirms,
  saveSnowballPendingConfirms,
  type SnowballPendingConfirm,
} from "./snowballConfirmStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import { saveSnowballConfirmLastRoundStats } from "./snowballConfirmRoundStatsStore";
import { fetchGreenDaysBeforeSignalBar } from "./greenDayStreak";
import {
  appendSnowballStatsRow,
  isSnowballStatsEnabled,
} from "./snowballStatsStore";
import { resolveSnowballStatsTradeSide } from "./snowballStatsTradeSide";
import {
  calculateTrendMomentumMetrics,
  isSustainedBuyingPressure,
  SNOWBALL_TREND_15M_DD_BARS,
  snowballGradeBSustainedMarginScale,
  trendMomentumStatsFields,
} from "./snowballTrendMomentumMetrics";

function labelSide(item: SnowballPendingConfirm): string {
  return item.side === "long" ? "LONG" : "BEAR";
}

function snowballConfirmRoundMaxList(): number {
  const n = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SCAN_SUMMARY_MAX_SYMBOLS?.trim());
  return Number.isFinite(n) && n >= 5 && n <= 120 ? Math.floor(n) : 45;
}

function pushRoundSym(arr: string[], entry: string): void {
  const max = snowballConfirmRoundMaxList();
  if (arr.length >= max) return;
  if (arr.includes(entry)) return;
  arr.push(entry);
}

function tfDurationSec(tf: BinanceIndicatorTf): number {
  if (tf === "15m") return 15 * 60;
  if (tf === "1h") return 60 * 60;
  return 4 * 60 * 60;
}

function fmtBkkFromUnixSec(sec: number): string {
  const d = new Date(sec * 1000);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time} BKK`;
}

function formatPriceCompact(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function pairSlashed(symbol: string): string {
  const u = symbol.toUpperCase();
  if (u.endsWith("USDT")) return `${u.slice(0, -4)}/USDT`;
  return u;
}

function mexcContractSymbolFromBinanceSymbol(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (!s) return "";
  if (s.includes("_")) return s;
  if (s.endsWith("USDT") && s.length > 4) {
    const base = s.slice(0, -4);
    return `${base}_USDT`;
  }
  return s;
}

/** SMA(volume) จนถึง idx (รวม idx) — align กับ vol rank 48 แท่ง */
const SNOWBALL_CONFIRM_VOL_SMA_PERIOD = 48;

function volumeSmaAtPackIndex(pack: BinanceKlinePack, idx: number, period: number): number {
  const { volume } = pack;
  const p = Math.max(1, Math.floor(period));
  const start = Math.max(0, idx - (p - 1));
  let sum = 0;
  let n = 0;
  for (let i = start; i <= idx; i++) {
    const v = volume[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

function volumeSmaConfirmAtPackIndex(pack: BinanceKlinePack, idx: number): number {
  return volumeSmaAtPackIndex(pack, idx, SNOWBALL_CONFIRM_VOL_SMA_PERIOD);
}

/** อันดับ volume ใน window [start,end] — 1 = สูงสุด */
function volumeRankInWindow(volume: number[], start: number, end: number, idx: number): number | null {
  const vi = volume[idx]!;
  if (!Number.isFinite(vi) || vi <= 0) return null;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let i = start; i <= end; i++) {
    if (i === idx) continue;
    const v = volume[i]!;
    if (Number.isFinite(v) && v > vi + eps) strictlyHigher++;
  }
  return strictlyHigher + 1;
}

function buildConfirmedMessage(opts: {
  item: SnowballPendingConfirm;
  bar2Close: number;
  bar2High: number;
  bar2Low: number;
  bar2Volume: number;
  bar2OpenSec: number;
  volRatio: number;
  volSma: number | null;
  volRank: number | null;
  volRankLookback: number;
}): string {
  const { item, bar2Close, bar2High, bar2Low, bar2Volume, bar2OpenSec, volRatio, volSma, volRank, volRankLookback } =
    opts;
  const sideLabel = item.side === "long" ? "🟢 LONG" : "🔴 SHORT";
  const refLabel = item.side === "long" ? "High" : "Low";
  const refVal = item.side === "long" ? item.signalHigh : item.signalLow;
  const cmp = item.side === "long" ? ">" : "<";
  const closeStr = formatPriceCompact(bar2Close);
  const refStr = formatPriceCompact(refVal);
  const bar2OpenBkk = fmtBkkFromUnixSec(bar2OpenSec);
  const bar2CloseBkk = fmtBkkFromUnixSec(bar2OpenSec + tfDurationSec(item.snowTf));
  const sigOpenBkk = fmtBkkFromUnixSec(item.signalBarOpenSec);
  const sigCloseBkk = fmtBkkFromUnixSec(item.signalBarOpenSec + tfDurationSec(item.snowTf));
  const volPct = Math.round(volRatio * 100);
  const volVsSma = volSma != null && Number.isFinite(volSma) && volSma > 0 ? bar2Volume / volSma : null;
  const volSmaStr =
    volVsSma != null && Number.isFinite(volVsSma)
      ? `${volVsSma.toFixed(2)}x SMA(${SNOWBALL_CONFIRM_VOL_SMA_PERIOD})`
      : `SMA(${SNOWBALL_CONFIRM_VOL_SMA_PERIOD})=—`;
  const volRankStr =
    volRank != null && Number.isFinite(volRank) ? `อันดับ vol #${volRank}/${volRankLookback}` : `อันดับ vol —/${volRankLookback}`;
  const lines: string[] = [
    `✅ Confirmed (${sideLabel}) — Snowball ${item.snowTf}`,
    `${pairSlashed(item.symbol)} — Binance USDT-M`,
    "",
    `แท่งสัญญาณ: เปิด ${sigOpenBkk} → ปิด ${sigCloseBkk} · ${refLabel}=${refStr}`,
    `แท่งยืนยัน: เปิด ${bar2OpenBkk} → ปิด ${bar2CloseBkk} · ปิด ${closeStr} ${cmp} ${refStr}`,
    `Volume แท่งยืนยัน = ${volPct}% ของแท่งสัญญาณ (≥ ${Math.round(snowballConfirmVolMinRatio() * 100)}%) · ${volSmaStr} · ${volRankStr}`,
    "",
    "หมายเหตุ: ยืนยันผ่าน 2-bar confirming แล้ว — แท่งที่ 1 ติด label เสี่ยงเอาไว้ก่อนหน้า",
  ];
  /* keep high/low ของแท่งยืนยันใส่ไว้สั้นๆ ให้รู้กรอบ */
  if (Number.isFinite(bar2High) && Number.isFinite(bar2Low)) {
    lines.push(`กรอบแท่งยืนยัน: H ${formatPriceCompact(bar2High)} · L ${formatPriceCompact(bar2Low)} · V ${bar2Volume.toLocaleString("en-US")}`);
  }
  lines.push("", "⚠️ Not financial advice");
  return lines.join("\n");
}

/** เรียกจาก cron — ตรวจรายการ pending แล้วส่ง Confirmed follow-up เมื่อแท่ง 2 ยืนยันผ่าน */
export async function runSnowballConfirmFollowUpTick(nowMs: number): Promise<number> {
  const roundStats = {
    atIso: new Date(nowMs).toISOString(),
    confirmed: [] as string[],
    failed: [] as string[],
    tgFailed: [] as string[],
  };

  if (!snowballConfirmBarEnabled()) {
    return 0;
  }
  if (!isPublicSnowballTripleCheckEnabled()) {
    return 0;
  }
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isBinanceIndicatorFapiEnabled()) {
    return 0;
  }
  if (!telegramSparkSystemGroupConfigured()) {
    return 0;
  }

  const state = await loadSnowballPendingConfirms();
  if (state.items.length === 0) {
    return 0;
  }

  const maxAgeMs = snowballConfirmMaxAgeHours() * 3600 * 1000;
  const volMinRatio = snowballConfirmVolMinRatio();
  const removeIds = new Set<string>();
  let sent = 0;

  /* group by (symbol, snowTf) เพื่อ fetch kline ครั้งเดียว */
  const groups = new Map<string, SnowballPendingConfirm[]>();
  for (const it of state.items) {
    const key = `${it.symbol}|${it.snowTf}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  for (const [groupKey, items] of Array.from(groups.entries())) {
    const first = items[0]!;
    const symbol = first.symbol;
    const snowTf = first.snowTf;
    let pack: Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> = null;
    let pack1hTrend: BinanceKlinePack | null = null;
    let pack15mTrend: BinanceKlinePack | null = null;
    try {
      [pack, pack1hTrend, pack15mTrend] = await Promise.all([
        fetchBinanceUsdmKlines(symbol, snowTf, 80),
        fetchBinanceUsdmKlines(symbol, "1h", 120),
        fetchBinanceUsdmKlines(symbol, "15m", SNOWBALL_TREND_15M_DD_BARS),
      ]);
    } catch (e) {
      console.error("[snowballConfirmTick] fetch kline", symbol, snowTf, e);
      continue;
    }
    if (!pack) {
      console.warn("[snowballConfirmTick] kline null", groupKey);
      continue;
    }

    const { open: barOpen, high, low, close, volume, timeSec } = pack;

    for (const item of items) {
      const ageMs = nowMs - item.alertedAtMs;
      if (ageMs > maxAgeMs) {
        pushRoundSym(roundStats.failed, `${item.symbol} ${labelSide(item)} (หมดอายุคิว)`);
        removeIds.add(item.id);
        continue;
      }
      const bar2OpenSec = item.signalBarOpenSec + tfDurationSec(snowTf);
      const bar2CloseMs = (bar2OpenSec + tfDurationSec(snowTf)) * 1000;
      if (nowMs < bar2CloseMs) {
        /* แท่ง 2 ยังไม่ปิด — รอรอบถัดไป */
        continue;
      }
      /* หา index ของแท่ง 2 ใน timeSec */
      const idx = timeSec.indexOf(bar2OpenSec);
      if (idx < 0) {
        /* ไม่เจอแท่ง 2 ใน kline ปัจจุบัน (drift / ดึงไม่พอ) — เก็บไว้ก่อน เผื่อรอบถัดไป */
        continue;
      }
      const cl = close[idx];
      const hi = high[idx];
      const lo = low[idx];
      const vo = volume[idx];
      if (
        typeof cl !== "number" ||
        typeof hi !== "number" ||
        typeof lo !== "number" ||
        typeof vo !== "number" ||
        !Number.isFinite(cl) ||
        !Number.isFinite(hi) ||
        !Number.isFinite(lo) ||
        !Number.isFinite(vo)
      ) {
        pushRoundSym(roundStats.failed, `${item.symbol} ${labelSide(item)} (ข้อมูลแท่ง 2 ไม่ครบ)`);
        removeIds.add(item.id);
        continue;
      }
      const priceOk = item.side === "long" ? cl > item.signalHigh : cl < item.signalLow;
      const volRatio = item.signalVolume > 0 ? vo / item.signalVolume : 0;
      const volOk = volRatio >= volMinRatio;
      if (priceOk && volOk) {
        const volSmaConfirm = volumeSmaConfirmAtPackIndex(pack, idx);
        const volSmaConfirmUse =
          Number.isFinite(volSmaConfirm) && volSmaConfirm > 0 ? volSmaConfirm : null;
        const volRankLookback = Math.min(SNOWBALL_CONFIRM_VOL_SMA_PERIOD, idx + 1);
        const volRank = volumeRankInWindow(volume, Math.max(0, idx - (volRankLookback - 1)), idx, idx);
        const text = buildConfirmedMessage({
          item,
          bar2Close: cl,
          bar2High: hi,
          bar2Low: lo,
          bar2Volume: vo,
          bar2OpenSec,
          volRatio,
          volSma: volSmaConfirmUse,
          volRank,
          volRankLookback,
        });
        let sendOk = false;
        try {
          sendOk = await sendPublicSnowballFeedToSparkGroup(text);
          if (sendOk) {
            sent += 1;
            pushRoundSym(roundStats.confirmed, `${item.symbol} ${labelSide(item)}`);
          } else {
            pushRoundSym(roundStats.tgFailed, `${item.symbol} ${labelSide(item)}`);
          }
        } catch (e) {
          console.error("[snowballConfirmTick] send confirm", item.symbol, item.side, e);
          pushRoundSym(roundStats.tgFailed, `${item.symbol} ${labelSide(item)}`);
        }
        if (sendOk && item.deferSnowballAutotradeToConfirm === true && isSnowballStatsEnabled()) {
          try {
            const iSig = timeSec.indexOf(item.signalBarOpenSec);
            let volSmaSig =
              typeof item.statsVolSma === "number" && Number.isFinite(item.statsVolSma) && item.statsVolSma > 0
                ? item.statsVolSma
                : NaN;
            if (!Number.isFinite(volSmaSig) && iSig >= 0) {
              volSmaSig = volumeSmaConfirmAtPackIndex(pack, iSig);
            }
            if (!Number.isFinite(volSmaSig) || volSmaSig <= 0) volSmaSig = item.signalVolume;
            const trigKind =
              typeof item.statsTriggerKind === "string" && item.statsTriggerKind.trim()
                ? item.statsTriggerKind.trim()
                : item.side === "bear"
                  ? "swing_ll"
                  : "both";
            const sigOpen = iSig >= 0 && typeof barOpen[iSig] === "number" ? barOpen[iSig]! : item.signalClose;
            const trendMomentum = calculateTrendMomentumMetrics(pack1hTrend, {
              pack15m: pack15mTrend,
            });
            const sustainedBuyingPressure = isSustainedBuyingPressure(trendMomentum);
            const statsTradeSide = resolveSnowballStatsTradeSide({
              alertSide: item.side === "long" ? "long" : "bear",
              qualityTier: item.qualityTier,
              signalOpen: sigOpen,
              signalClose: item.signalClose,
              signalHigh: item.signalHigh,
              signalLow: item.signalLow,
              signalVolume: item.signalVolume,
              confirmOpen: barOpen[idx],
              confirmClose: cl,
              confirmVolume: vo,
            });
            const greenDaysBeforeSignal = await fetchGreenDaysBeforeSignalBar(
              item.symbol,
              item.signalBarOpenSec,
              item.snowTf,
            );
            await appendSnowballStatsRow({
              symbol: item.symbol,
              side: statsTradeSide,
              alertSide: item.side === "long" ? "long" : "bear",
              alertedAtIso: item.alertedAtIso,
              alertedAtMs: item.alertedAtMs,
              signalBarOpenSec: item.signalBarOpenSec,
              signalBarTf: item.snowTf,
              ...(item.side === "long" ? { signalBarLow: item.signalLow } : {}),
              entryPrice: item.signalClose,
              intrabar: false,
              triggerKind: trigKind,
              vol: item.signalVolume,
              volSma: volSmaSig,
              qualityTier: item.qualityTier,
              alertQualityTier: item.qualityTier,
              ...(item.statsStructureTier ? { structureTier: item.statsStructureTier } : {}),
              ...(typeof item.statsSwing200Ok === "boolean"
                ? { swing200Ok: item.statsSwing200Ok }
                : {}),
              momentumDowngrade: item.qualityTier === "d_plus",
              momentumFailGradeF: item.qualityTier === "f_plus",
              atr100: item.statsAtr100 ?? null,
              maxUpperWick100: item.statsMaxUpperWick100 ?? null,
              rangeScore: item.statsRangeScore ?? null,
              wickScore: item.statsWickScore ?? null,
              barRangePctPrev: item.statsBarRangePctPrev ?? null,
              barRangePctSignal: item.statsBarRangePctSignal ?? null,
              barRangePct2Sum: item.statsBarRangePct2Sum ?? null,
              btcPsar4hTrend: item.statsBtcPsar4hTrend ?? null,
              btcPsar4hClose: item.statsBtcPsar4hClose ?? null,
              btcPsar1hTrend: item.statsBtcPsar1hTrend ?? null,
              btcPsar1hClose: item.statsBtcPsar1hClose ?? null,
              quoteVol24hUsdt: item.statsQuoteVol24hUsdt ?? null,
              marketCapUsd: item.statsMarketCapUsd ?? null,
              fundingRate: item.statsFundingRate ?? null,
              signalVolVsSma: item.statsSignalVolVsSma ?? null,
              volStrictOk: item.statsVolStrictOk ?? null,
              volNearMissOnly: item.statsVolNearMissOnly ?? null,
              volMultAtAlert: item.statsVolMultAtAlert ?? null,
              volNearMultAtAlert: item.statsVolNearMultAtAlert ?? null,
              confirmGateSteps: item.statsConfirmGateSteps ?? undefined,
              ...trendMomentumStatsFields(trendMomentum),
              confirmVolVsSma:
                volSmaConfirmUse != null && volSmaConfirmUse > 0 ? vo / volSmaConfirmUse : null,
              confirmVolRank: volRank,
              confirmVolRankLb: volRank != null && Number.isFinite(volRank) ? volRankLookback : null,
              greenDaysBeforeSignal,
            });
          } catch (e) {
            console.error("[snowballConfirmTick] append snowball stats after confirm", item.symbol, item.side, e);
          }
        }
        if (sendOk && item.deferSnowballAutotradeToConfirm === true) {
          try {
            const volSma = volumeSmaConfirmAtPackIndex(pack, idx);
            const volSmaUse = Number.isFinite(volSma) && volSma > 0 ? volSma : vo;
            const trendMomentumConfirm = calculateTrendMomentumMetrics(pack1hTrend, {
              pack15m: pack15mTrend,
            });
            const sustainedBuyingPressure = isSustainedBuyingPressure(trendMomentumConfirm);
            let marginScale: number | undefined;
            if (item.side === "long" && item.qualityTier === "b_plus" && sustainedBuyingPressure) {
              marginScale = snowballGradeBSustainedMarginScale();
            }
            const greenDaysForAutoOpen =
              item.side === "long"
                ? await fetchGreenDaysBeforeSignalBar(
                    item.symbol,
                    item.signalBarOpenSec,
                    item.snowTf,
                  )
                : undefined;
            await runSnowballAutoTradeAfterSnowballAlert({
              contractSymbol: mexcContractSymbolFromBinanceSymbol(item.symbol),
              binanceSymbol: item.symbol,
              alertSide: item.side,
              displayGrade: item.statsDisplayGrade,
              qualityTier: item.qualityTier,
              momentumFailGradeF: item.qualityTier === "f_plus",
              momentumDowngrade: item.qualityTier === "d_plus",
              referenceEntryPrice: cl,
              signalBarOpenSec: bar2OpenSec,
              signalBarTf: item.snowTf,
              signalBarLow: item.side === "long" ? lo : null,
              vol: vo,
              volSma: volSmaUse,
              greenDaysBeforeSignal: greenDaysForAutoOpen,
              fundingRate: item.statsFundingRate ?? null,
              ...(marginScale != null ? { marginScale } : {}),
            });
          } catch (e) {
            console.error("[snowballConfirmTick] snowball auto-open after confirm", item.symbol, item.side, e);
          }
        }
        removeIds.add(item.id);
      } else {
        const reason =
          !priceOk && !volOk
            ? "ราคา+vol"
            : !priceOk
              ? "ราคา"
              : "vol";
        pushRoundSym(roundStats.failed, `${item.symbol} ${labelSide(item)} (${reason})`);
        /* แท่ง 2 ปิดแล้วแต่ไม่ผ่าน — drop เงียบกัน spam */
        removeIds.add(item.id);
      }
    }
  }

  if (removeIds.size > 0) {
    const next = state.items.filter((it) => !removeIds.has(it.id));
    await saveSnowballPendingConfirms({ items: next });
  }

  try {
    await saveSnowballConfirmLastRoundStats(roundStats);
  } catch (e) {
    console.error("[snowballConfirmTick] save last round stats", e);
  }

  return sent;
}
