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
} from "./publicIndicatorFeed";
import {
  loadSnowballPendingConfirms,
  saveSnowballPendingConfirms,
  type SnowballPendingConfirm,
} from "./snowballConfirmStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  saveSnowballConfirmLastRoundStats,
} from "./snowballConfirmRoundStatsStore";

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

/** SMA(volume) ย้อนหลังสูงสุด 20 แท่ง จนถึง idx (รวม idx) */
function volumeSma20AtPackIndex(pack: BinanceKlinePack, idx: number): number {
  const { volume } = pack;
  const period = 20;
  const start = Math.max(0, idx - (period - 1));
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

function buildConfirmedMessage(opts: {
  item: SnowballPendingConfirm;
  bar2Close: number;
  bar2High: number;
  bar2Low: number;
  bar2Volume: number;
  bar2OpenSec: number;
  volRatio: number;
}): string {
  const { item, bar2Close, bar2High, bar2Low, bar2Volume, bar2OpenSec, volRatio } = opts;
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
  const lines: string[] = [
    `✅ Confirmed (${sideLabel}) — Snowball ${item.snowTf}`,
    `${pairSlashed(item.symbol)} — Binance USDT-M`,
    "",
    `แท่งสัญญาณ: เปิด ${sigOpenBkk} → ปิด ${sigCloseBkk} · ${refLabel}=${refStr}`,
    `แท่งยืนยัน: เปิด ${bar2OpenBkk} → ปิด ${bar2CloseBkk} · ปิด ${closeStr} ${cmp} ${refStr}`,
    `Volume แท่งยืนยัน = ${volPct}% ของแท่งสัญญาณ (≥ ${Math.round(snowballConfirmVolMinRatio() * 100)}%)`,
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
    try {
      pack = await fetchBinanceUsdmKlines(symbol, snowTf, 80);
    } catch (e) {
      console.error("[snowballConfirmTick] fetch kline", symbol, snowTf, e);
      continue;
    }
    if (!pack) {
      console.warn("[snowballConfirmTick] kline null", groupKey);
      continue;
    }

    const { high, low, close, volume, timeSec } = pack;

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
        const text = buildConfirmedMessage({
          item,
          bar2Close: cl,
          bar2High: hi,
          bar2Low: lo,
          bar2Volume: vo,
          bar2OpenSec,
          volRatio,
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
        if (
          sendOk &&
          item.deferSnowballAutotradeToConfirm === true &&
          item.qualityTier === "a_plus"
        ) {
          try {
            const volSma = volumeSma20AtPackIndex(pack, idx);
            const volSmaUse = Number.isFinite(volSma) && volSma > 0 ? volSma : vo;
            await runSnowballAutoTradeAfterSnowballAlert({
              contractSymbol: mexcContractSymbolFromBinanceSymbol(item.symbol),
              binanceSymbol: item.symbol,
              side: item.side === "long" ? "long" : "short",
              referenceEntryPrice: cl,
              signalBarOpenSec: bar2OpenSec,
              signalBarTf: item.snowTf,
              signalBarLow: item.side === "long" ? lo : null,
              vol: vo,
              volSma: volSmaUse,
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
