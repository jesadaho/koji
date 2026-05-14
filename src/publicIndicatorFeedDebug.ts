import {
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
} from "./binanceIndicatorKline";
import { loadPriceSyncCronRecord } from "./cronStatusStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import {
  evaluateSnowballChecklist,
  getIndicatorPublicScanParams,
  isIndicatorPublicFeedEnabled,
  isPublicSnowballTripleCheckEnabled,
  publicRsiDivergenceTfs,
  publicRsiEmaCrossTf,
  snowballConfirmBarEnabled,
  snowballSkipTelegramWhenPendingConfirm,
  snowballWaveGateEnabled,
  type SnowballChecklistResult,
  type SnowballConfirmRiskGateStatus,
  type SnowballSideEval,
  type SnowballWaveGateStatus,
} from "./publicIndicatorFeed";

const MAX_OUT = 3800;

function envFlag(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

function rsiThresholdFromEnv(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_RSI_THRESHOLD);
  return Number.isFinite(v) ? v : 50;
}

function normalizeBinanceUsdt(sym: string): string {
  const s = sym.trim().toUpperCase().replace(/^@/, "");
  if (!s) return "";
  if (s.endsWith("USDT")) return s;
  return `${s}USDT`;
}

/**
 * Admin debug — Telegram / LINE
 * ตัวอย่าง: `debug public feed` · `debug public feed USELESS` · `#publicfeeddebug` · `เช็ค public feed SOL`
 */
export function parsePublicFeedDebugCommand(text: string): { symbol?: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  const patterns = [
    /^debug\s+public\s+feed(?:\s+(\S+))?\s*$/i,
    /^#publicfeeddebug(?:\s+(\S+))?\s*$/i,
    /^public\s+feed\s+debug(?:\s+(\S+))?\s*$/i,
    /^เช็ค\s+public\s+feed(?:\s+(\S+))?\s*$/i,
    /^เช็ค\s+indicator\s+feed(?:\s+(\S+))?\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const raw = m[1]?.trim();
      return { symbol: raw && raw.length > 0 ? raw : undefined };
    }
  }
  return null;
}

export async function formatPublicIndicatorFeedDebugMessage(opts: { symbol?: string }): Promise<string> {
  const lines: string[] = [];
  const p = getIndicatorPublicScanParams();
  const rsiEmaTf = publicRsiEmaCrossTf();
  const divTfs = publicRsiDivergenceTfs();
  const rsiTh = rsiThresholdFromEnv();
  const rsiSkip50 = Math.abs(rsiTh - 50) < 1e-9;

  lines.push("📊 Public indicator feed — debug");
  lines.push(`UTC: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("— env / gate —");
  lines.push(`INDICATOR_PUBLIC_FEED_ENABLED: ${isIndicatorPublicFeedEnabled() ? "on" : "off"}`);
  lines.push(`BINANCE_INDICATOR_FAPI_ENABLED: ${isBinanceIndicatorFapiEnabled() ? "on" : "off"}`);
  lines.push(`Telegram public (Spark system group): ${telegramSparkSystemGroupConfigured() ? "configured" : "missing"}`);
  lines.push("");
  lines.push("— toggles —");
  lines.push(`RSI cross: ${envFlag("INDICATOR_PUBLIC_RSI_ENABLED", true) ? "on" : "off"} · threshold ${rsiTh}${rsiSkip50 ? " (50 = ปิดสัญญาณในโค้ด)" : ""}`);
  lines.push(`EMA cross: ${envFlag("INDICATOR_PUBLIC_EMA_ENABLED", true) ? "on" : "off"}`);
  lines.push(`RSI divergence: ${envFlag("INDICATOR_PUBLIC_RSI_DIVERGENCE_ENABLED", true) ? "on" : "off"}`);
  lines.push(`Snowball: ${isPublicSnowballTripleCheckEnabled() ? "on" : "off"}`);
  lines.push("");
  lines.push("— timeframe —");
  lines.push(`RSI/EMA TF: ${rsiEmaTf} (INDICATOR_PUBLIC_RSI_EMA_TF)`);
  lines.push(`Divergence TFs: ${divTfs.join(", ") || "—"} (INDICATOR_PUBLIC_RSI_DIVERGENCE_TFS)`);
  lines.push(`Snowball TF: ${p.snowTf} (INDICATOR_PUBLIC_SNOWBALL_TF)`);
  lines.push("");
  lines.push("— universe —");
  lines.push(`INDICATOR_PUBLIC_TOP_ALTS (RSI/EMA/Div): ${p.coreTopAlts} → สแกน index 0..${p.coreTopAlts <= 0 ? 1 : 1 + p.coreTopAlts} (BTC+ETH+${Math.max(0, p.coreTopAlts)} alts)`);
  lines.push(`INDICATOR_PUBLIC_SNOWBALL_TOP_ALTS: ${p.snowballTopAlts}`);
  lines.push(`symbol list TTL: ${Math.round(p.symbolListTtlMs / 60000)} min`);
  lines.push(`public cooldown: ${Math.round(p.publicCooldownMs / 60000)} min`);
  lines.push("");

  try {
    const rec = await loadPriceSyncCronRecord();
    if (!rec) {
      lines.push("— last price-sync record —");
      lines.push("ไม่มีบันทึก (บน Vercel ต้องมี KV/Redis สำหรับ cron_status_price_sync)");
    } else {
      lines.push("— last price-sync record —");
      lines.push(`at: ${rec.at} · durationMs: ${rec.durationMs}`);
      const ind = rec.steps.indicatorAlerts;
      if (ind) {
        lines.push(
          `indicatorAlerts: ok=${ind.ok}${ind.detail ? ` · ${ind.detail}` : ""}${ind.error ? ` · ERR ${ind.error}` : ""}`,
        );
      } else {
        lines.push("indicatorAlerts: — (ไม่มีใน record)");
      }
      const sb = rec.steps.spotFutBasisAlerts;
      if (sb) {
        lines.push(`spotFutBasisAlerts: ok=${sb.ok}${sb.detail ? ` · ${sb.detail}` : ""}${sb.error ? ` · ERR ${sb.error}` : ""}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push(`— last price-sync record — อ่านไม่สำเร็จ: ${msg.slice(0, 200)}`);
  }

  const symOpt = opts.symbol?.trim();
  if (symOpt) {
    lines.push("");
    const sym = normalizeBinanceUsdt(symOpt);
    if (!sym) {
      lines.push("— symbol —");
      lines.push("สัญลักษณ์ว่าง");
    } else {
      lines.push(`— symbol ${sym} —`);
      const fetchN = Math.max(150, p.coreTopAlts + 2, p.snowballTopAlts + 2);
      let rank = -1;
      try {
        const top = await fetchTopUsdmUsdtSymbolsByQuoteVolume(fetchN);
        rank = top.indexOf(sym);
        if (rank >= 0) {
          lines.push(`Binance USDM quoteVol rank (top ${fetchN}, excl. BTC/ETH/stables): #${rank + 1}`);
        } else {
          lines.push(`ไม่อยู่ใน top ${fetchN} ตาม quoteVol (หรือเป็นคู่ที่ถูกกรองออก)`);
        }
      } catch (e) {
        lines.push(`rank lookup fail: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }

      const idxInFeed = rank >= 0 ? 2 + rank : -1;
      const maxCore = p.coreTopAlts <= 0 ? 2 : 2 + p.coreTopAlts;
      const inCore = idxInFeed >= 0 && idxInFeed < maxCore;
      lines.push(`index ในลิสต์ feed (BTC=0, ETH=1): ${idxInFeed >= 0 ? idxInFeed : "—"}`);
      lines.push(`RSI/EMA/Div สแกนหรือไม่: ${inCore ? "ใช่ (อยู่ใน BTC+ETH+TOP_ALTS)" : "ไม่ (นอกช่วงสแกน)"} · max index = ${maxCore - 1}`);

      const inSnowUniverse = rank >= 0 && rank < p.snowballTopAlts;
      lines.push(`Snowball สแกนหรือไม่: ${inSnowUniverse ? "ใช่ (อยู่ใน top snowball alts)" : "ไม่"}`);

      try {
        const pack = await fetchBinanceUsdmKlines(sym, rsiEmaTf);
        if (!pack) {
          lines.push(`klines ${rsiEmaTf}: null (API ปิด / error / ไม่มีสัญญา)`);
        } else {
          const n = pack.close.length;
          lines.push(`klines ${rsiEmaTf}: ok · bars=${n} · lastClose=${pack.close[n - 1]}`);
        }
      } catch (e) {
        lines.push(`klines: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      }
    }
  }

  lines.push("");
  lines.push("รอบจริง: GET /api/cron/price-sync (~15m) — HTTP 200 ไม่ได้แปลว่ามีการแจ้งเตือน");
  lines.push("ดู Snowball checklist รายเหรียญ: debug snowball USELESS");

  let out = lines.join("\n");
  if (out.length > MAX_OUT) out = `${out.slice(0, MAX_OUT - 20)}\n…(truncated)`;
  return out;
}

/**
 * Admin debug — `debug snowball SYMBOL`
 * เดิน checklist เดียวกับ Snowball live tick บนแท่งปิดล่าสุด (+ intrabar ถ้าเปิด)
 */
export function parseSnowballDebugCommand(text: string): { symbol: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  const patterns = [
    /^debug\s+snowball\s+(\S+)\s*$/i,
    /^snowball\s+debug\s+(\S+)\s*$/i,
    /^#snowballdebug\s+(\S+)\s*$/i,
    /^เช็ค\s+snowball\s+(\S+)\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1]?.trim()) return { symbol: m[1].trim() };
  }
  return null;
}

function checkMark(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function tfSeconds(tf: BinanceIndicatorTf): number {
  switch (tf) {
    case "15m":
      return 15 * 60;
    case "1h":
      return 60 * 60;
    case "4h":
      return 4 * 60 * 60;
  }
}

function fmtMsBkk(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time} BKK`;
}

/** Vercel cron "* /15 * * * *" — รอบถัดไปคือ quarter-hour ของ UTC ที่ >= ms */
function nextCronTickMs(ms: number): number {
  const FIFTEEN = 15 * 60 * 1000;
  return Math.ceil(ms / FIFTEEN) * FIFTEEN;
}

function fmtRelativeFromNow(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diff >= 0 ? "ภายใน 1 นาที" : "เมื่อ <1 นาทีที่แล้ว";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diff >= 0 ? `ใน ~${span}` : `เมื่อ ~${span} ที่แล้ว`;
}

function renderExpectedAlertLines(
  ev: SnowballSideEval,
  snowTf: BinanceIndicatorTf,
  nowMs: number,
): string[] {
  if (!ev.allPassed) return [];
  const out: string[] = [];
  const barCloseMs = (ev.barOpenSec + tfSeconds(snowTf)) * 1000;
  const nextCronMs = nextCronTickMs(nowMs); /* รอบ cron ถัดไปจากตอนนี้ */
  const cronAfterCloseMs = nextCronTickMs(barCloseMs);

  if (ev.intrabar) {
    /* แท่งกำลังก่อ + intrabar=on → ยิงได้ตั้งแต่ cron รอบถัดไป จนถึงก่อนแท่งปิด */
    out.push(`  ⏰ Bar will close: ${fmtMsBkk(barCloseMs)} (${fmtRelativeFromNow(barCloseMs, nowMs)})`);
    out.push(
      `  📣 Expected alert: cron รอบถัดไป ~${fmtMsBkk(nextCronMs)} (${fmtRelativeFromNow(nextCronMs, nowMs)}) — deadline ก่อนแท่งปิด`,
    );
    return out;
  }

  /* แท่งปิดแล้ว — ยิงรอบ cron แรกที่รันหลังเวลาปิดแท่ง */
  const sameSlot = cronAfterCloseMs === barCloseMs;
  out.push(`  ⏰ เวลาปิดแท่ง: ${fmtMsBkk(barCloseMs)} (${fmtRelativeFromNow(barCloseMs, nowMs)})`);
  if (nowMs >= cronAfterCloseMs) {
    out.push(
      sameSlot
        ? `  📣 Expected alert (cron 15m UTC): ${fmtMsBkk(cronAfterCloseMs)} — ตรง slot หลังปิดแท่ง · ครบเวลาแล้ว (${fmtRelativeFromNow(cronAfterCloseMs, nowMs)})`
        : `  📣 Expected alert (cron 15m UTC): ${fmtMsBkk(cronAfterCloseMs)} — ครบเวลายิงไปแล้ว (${fmtRelativeFromNow(cronAfterCloseMs, nowMs)})`,
    );
    out.push("  ⚠️ ถ้ายังไม่ได้รับ: deploy แพตช์ early-skip แล้วหรือยัง · Vercel logs /api/cron/price-sync · `debug public feed USELESS` ดู rank ใน Snowball universe");
  } else {
    out.push(
      `  📣 Expected alert (cron 15m UTC): ${fmtMsBkk(cronAfterCloseMs)} (${fmtRelativeFromNow(cronAfterCloseMs, nowMs)})`,
    );
  }
  return out;
}

function formatPriceShort(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function renderConfirmRiskBlock(label: string, status: SnowballConfirmRiskGateStatus | null): string[] {
  if (!status) return [`${label}: — (ไม่มีข้อมูล)`];
  const lines: string[] = [];
  const head = status.flagged ? "🟡 มีความเสี่ยง — Pending Confirm" : "🟢 สะอาด — ไม่ต้องรอแท่ง 2";
  lines.push(`${label}: ${head}`);

  const wh = status.detail.wickHistory;
  const whPct = (wh.ratio * 100).toFixed(0);
  lines.push(
    `  ${wh.flagged ? "🟡" : "✅"} Wick history (${wh.lookback}b · shadow>body×${wh.bodyRatio}): wicky=${wh.wickyCount}/${wh.total} (${whPct}%)`,
  );

  const sz = status.detail.supplyZone;
  const refStr = formatPriceShort(sz.refLevel);
  const distStr = sz.distPct != null ? `${Math.abs(sz.distPct).toFixed(2)}%` : "—";
  lines.push(
    `  ${sz.flagged ? "🟡" : "✅"} Supply/Demand zone (${sz.lookback}b · ≤${(sz.zonePct * 100).toFixed(1)}%): ref=${refStr} · ห่าง ${distStr}`,
  );

  const sw = status.detail.signalWick;
  lines.push(
    `  ${sw.flagged ? "🟡" : "✅"} Signal bar wick (shadow>body×${sw.signalRatio}): shadow=${sw.shadow.toFixed(6)} · body=${sw.body.toFixed(6)}`,
  );

  if (status.flagged && status.trigger.refLevel != null) {
    const cmp = status.trigger.side === "long" ? ">" : "<";
    const refName = status.trigger.side === "long" ? "High" : "Low";
    const volPct = Math.round(status.trigger.volMinRatio * 100);
    lines.push(
      `  ⏳ ถ้ายิงจริงจะติด Pending Confirm: bar2 close ${cmp} ${refName}=${formatPriceShort(status.trigger.refLevel)} + Vol ≥ ${volPct}% ของแท่งนี้`,
    );
  }
  return lines;
}

function renderWaveGateBlock(label: string, status: SnowballWaveGateStatus | null): string[] {
  if (!status) return [`${label}: — (ไม่มีข้อมูล)`];
  const lines: string[] = [];
  if (!status.active) {
    lines.push(`${label}: ⚪ ปิดอยู่ — INDICATOR_PUBLIC_SNOWBALL_WAVE_GATE_ENABLED=0`);
    return lines;
  }
  if (status.lastAlertPrice == null || status.lastAlertBarOpenSec == null) {
    lines.push(`${label}: 🟢 ยังไม่เคยยิง — ไม่ใช้ gate (ผ่านอัตโนมัติ)`);
    return lines;
  }
  const head = status.blocked ? "🔴 BLOCKED (อยู่ในคลื่นเดิม)" : "🟢 PASS (ถือเป็นรอบใหม่)";
  lines.push(`${label}: ${head}`);
  lines.push(
    `  • Last alert: price=${formatPriceShort(status.lastAlertPrice)} · bar=${status.lastAlertBarOpenSec}`,
  );
  lines.push(`  • Current close: ${formatPriceShort(status.currentClose)}`);
  lines.push(
    `  • Reset เกณฑ์: RSI ${status.rsiResetThreshold} · EMA${status.emaResetPeriod} touch · new ${(status.newHighPct * 100).toFixed(0)}% breakout`,
  );
  if (status.resetReason) {
    lines.push(`  • ผ่านเพราะ: ${status.resetReason}`);
  }
  if (status.reason) {
    lines.push(`  • ${status.blocked ? "Block เพราะ" : "หมายเหตุ"}: ${status.reason}`);
  }
  return lines;
}

/** สรุปว่า cron จะยิง TG หรือไม่ — wave gate + confirm-bar อยู่นอก `steps` ของ PASS ด้านบน */
function renderPostChecklistTelegramHints(res: SnowballChecklistResult): string[] {
  const longOk = res.long.closed?.allPassed === true;
  const bearOk = res.bear.closed?.allPassed === true;
  if (!longOk && !bearOk) return [];

  const lines: string[] = [];
  lines.push("— ผลยิง Telegram สาธารณะ (หลัง checklist — ไม่รวมในแถว PASS ด้านบน) —");
  lines.push(
    "  หมายเหตุ: รอบจริงยังมี (1) wave gate (2) confirm-bar risk → อาจไม่ส่งแม้ checklist ผ่านครบ; ถ้ามี pending คนละ type บน (symbol,tf,side) จะถูก dedupe ใน cron",
  );

  const waveLine = (side: "long" | "bear", wg: SnowballWaveGateStatus | null | undefined): void => {
    if (!snowballWaveGateEnabled()) {
      lines.push(`  • ${side} wave gate: ปิดใน env`);
      return;
    }
    if (!wg) {
      lines.push(`  • ${side} wave gate: —`);
      return;
    }
    if (!wg.active) {
      lines.push(`  • ${side} wave gate: ปิด`);
      return;
    }
    if (wg.lastAlertPrice == null || wg.lastAlertBarOpenSec == null) {
      lines.push(`  • ${side} wave gate: ยังไม่เคยยิง — ไม่บล็อก`);
      return;
    }
    if (wg.blocked) {
      lines.push(`  • ${side} wave gate: 🔴 ไม่ยิง — ${wg.reason ?? "blocked"}`);
    } else {
      lines.push(`  • ${side} wave gate: 🟢 ผ่าน${wg.resetReason ? ` (${wg.resetReason})` : ""}`);
    }
  };

  const confirmTgLine = (side: "long" | "bear"): void => {
    if (!snowballConfirmBarEnabled()) {
      lines.push(`  • ${side} confirm-bar: ปิดใน env — ไม่กระทบการส่งแท่ง 1`);
      return;
    }
    const cr = side === "long" ? res.confirmRisk?.long : res.confirmRisk?.bear;
    if (!cr) {
      lines.push(`  • ${side} confirm-bar: —`);
      return;
    }
    if (!cr.flagged) {
      lines.push(`  • ${side} confirm-bar: ไม่ติด risk label — ส่ง Snowball ไปกลุ่มตามปกติ`);
      return;
    }
    const n = cr.flags.length;
    if (snowballSkipTelegramWhenPendingConfirm()) {
      lines.push(
        `  • ${side} confirm-bar: 🟡 มี ${n} risk label + INDICATOR_PUBLIC_SNOWBALL_SKIP_TG_ON_PENDING_CONFIRM เปิด (ค่าเริ่มต้น) → cron ไม่ส่งข้อความ Snowball ไปกลุ่มที่แท่งนี้ (ยังบันทึกสถิติ + คิว confirm แท่ง 2)`,
      );
    } else {
      lines.push(
        `  • ${side} confirm-bar: 🟡 มี ${n} risk label แต่ส่ง TG แท่ง 1 ได้ — SKIP_TG_ON_PENDING_CONFIRM=0`,
      );
    }
  };

  if (longOk) {
    lines.push("LONG:");
    waveLine("long", res.waveGate?.long);
    confirmTgLine("long");
  }
  if (bearOk) {
    if (longOk) lines.push("");
    lines.push("BEAR:");
    waveLine("bear", res.waveGate?.bear);
    confirmTgLine("bear");
  }
  lines.push("");
  return lines;
}

function renderSnowballSideBlock(
  title: string,
  ev: SnowballSideEval | null,
  snowTf: BinanceIndicatorTf,
  nowMs: number,
): string[] {
  if (!ev) return [`${title}: — (ข้ามเพราะ index ไม่พร้อม)`];
  const lines: string[] = [];
  const barCloseMs = (ev.barOpenSec + tfSeconds(snowTf)) * 1000;
  const openBkk = fmtMsBkk(ev.barOpenSec * 1000);
  const closeBkk = fmtMsBkk(barCloseMs);
  const stamp = ev.intrabar
    ? `แท่งกำลังก่อ · เปิด ${openBkk} → ปิด ~${closeBkk} · close=${ev.closePrice}`
    : `แท่งปิดแล้ว · เปิด ${openBkk} → ปิด ${closeBkk} · close=${ev.closePrice}`;
  lines.push(`${title} · ${ev.allPassed ? "PASS ✅" : "BLOCK ❌"} · ${stamp}`);
  let firstFailMarked = false;
  for (const s of ev.steps) {
    const mark = checkMark(s.ok);
    const tag = !s.ok && !firstFailMarked ? " ← BLOCK" : "";
    if (!s.ok) firstFailMarked = true;
    lines.push(`  ${mark} ${s.label}: ${s.detail}${tag}`);
  }
  lines.push(...renderExpectedAlertLines(ev, snowTf, nowMs));
  return lines;
}

export async function formatSnowballChecklistDebugMessage(rawSymbol: string): Promise<string> {
  const lines: string[] = [];
  let res: SnowballChecklistResult | null = null;
  try {
    res = await evaluateSnowballChecklist(rawSymbol);
  } catch (e) {
    return `debug snowball ล้มเหลว — ${(e instanceof Error ? e.message : String(e)).slice(0, 500)}`;
  }

  lines.push(`🟦 Snowball checklist — ${res.symbol || "(no symbol)"}`);
  lines.push(`UTC: ${new Date().toISOString()}`);
  lines.push(`Snowball enabled: ${res.enabled ? "on" : "off"} · TF=${res.snowTf} · bars=${res.bars ?? "—"}`);
  lines.push("");

  if (res.errors.length > 0) {
    lines.push("— errors —");
    for (const e of res.errors) lines.push(`  ❌ ${e}`);
    lines.push("");
  }

  lines.push("— params —");
  for (const s of res.paramsSummary) lines.push(`  • ${s}`);
  lines.push("");

  const nowMs = Date.now();

  if (res.long.closed || res.long.intrabar) {
    lines.push("— LONG (BULL) —");
    lines.push(...renderSnowballSideBlock("Closed bar", res.long.closed, res.snowTf, nowMs));
    if (res.long.intrabar) {
      lines.push("");
      lines.push(...renderSnowballSideBlock("Intrabar (forming)", res.long.intrabar, res.snowTf, nowMs));
    }
    lines.push("");
  }

  if (res.bear.closed || res.bear.intrabar) {
    lines.push("— BEAR (SHORT) —");
    lines.push(...renderSnowballSideBlock("Closed bar", res.bear.closed, res.snowTf, nowMs));
    if (res.bear.intrabar) {
      lines.push("");
      lines.push(...renderSnowballSideBlock("Intrabar (forming)", res.bear.intrabar, res.snowTf, nowMs));
    }
    lines.push("");
  }

  lines.push(...renderPostChecklistTelegramHints(res));

  if (res.confirmRisk) {
    lines.push("— confirm-bar risk gates (label only) —");
    lines.push(...renderConfirmRiskBlock("LONG", res.confirmRisk.long));
    lines.push(...renderConfirmRiskBlock("BEAR", res.confirmRisk.bear));
    lines.push("");
  } else if (!snowballConfirmBarEnabled()) {
    lines.push("— confirm-bar risk gates —");
    lines.push("  (ปิดอยู่ — INDICATOR_PUBLIC_SNOWBALL_CONFIRM_BAR_ENABLED=0)");
    lines.push("");
  }

  if (res.waveGate) {
    lines.push("— wave gate (กันยิงซ้ำในคลื่นเดิม) —");
    lines.push(...renderWaveGateBlock("LONG", res.waveGate.long));
    lines.push(...renderWaveGateBlock("BEAR", res.waveGate.bear));
    lines.push("");
  } else if (!snowballWaveGateEnabled()) {
    lines.push("— wave gate —");
    lines.push("  (ปิดอยู่ — INDICATOR_PUBLIC_SNOWBALL_WAVE_GATE_ENABLED=0)");
    lines.push("");
  }

  lines.push(
    "หมายเหตุ: PASS ด้านบน = เฉพาะ technical checklist (volume / swing / body / dedupe / cooldown); wave gate + confirm-bar สรุปผลยิง TG ในบล็อก «ผลยิง Telegram» และรายละเอียดด้านล่าง",
  );
  lines.push("checklist จำลองจาก kline ล่าสุดที่ขอ + state cooldown ปัจจุบัน");
  lines.push("รอบจริงสแกนทุก ~15 นาที ที่ /api/cron/price-sync (แท่งปิดตาม TF Snowball)");
  lines.push("Expected alert คำนวณจาก Vercel cron schedule (ทุก 15 นาที UTC)");
  lines.push("Swing HH / VAH: เงื่อนไขเป็น OR — VAH (ยังไม่) แปลว่ายังไม่ cross แท่งนั้น แต่ถ้า swing ทะลุ HH แล้วก็ยัง PASS ได้");
  lines.push("เนื้อเทียน/ช่วง (body÷range): กรองก่อน dedupe — ตรงกับสแกน longBodyRatioBlocked; คนละชุดกับ wick history / signal wick ใน confirm-bar");
  lines.push("Follow-through: ถ้าไม่ผ่าน body÷range แต่ close ทะลุ high แท่งก่อน (long) / ต่ำกว่า low แท่งก่อน (short) ให้ผ่าน — INDICATOR_PUBLIC_SNOWBALL_BODY_FOLLOW_THROUGH_ENABLED");

  let out = lines.join("\n");
  if (out.length > MAX_OUT) out = `${out.slice(0, MAX_OUT - 20)}\n…(truncated)`;
  return out;
}
