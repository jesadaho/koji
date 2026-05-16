import type { CandleReversalModel, CandleReversalTf } from "./candleReversalDetect";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return defaultOn;
}

export function isCandleReversalScanSummaryToChatEnabled(): boolean {
  return envFlagOn("CANDLE_REVERSAL_SCAN_SUMMARY_TO_CHAT", true);
}

export function candleReversalScanSummaryMaxSymbols(): number {
  const n = Number(process.env.CANDLE_REVERSAL_SCAN_SUMMARY_MAX_SYMBOLS?.trim());
  if (Number.isFinite(n) && n >= 5 && n <= 120) return Math.floor(n);
  const snow = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SCAN_SUMMARY_MAX_SYMBOLS?.trim());
  if (Number.isFinite(snow) && snow >= 5 && snow <= 120) return Math.floor(snow);
  return 45;
}

function coinShort(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u;
}

export function pushReversalScanSymList(list: string[], symbol: string): void {
  const max = candleReversalScanSummaryMaxSymbols();
  if (list.length >= max) return;
  const entry = coinShort(symbol);
  if (list.includes(entry)) return;
  list.push(entry);
}

function formatSymbolListLines(indent: string, symbols: string[]): string[] {
  if (symbols.length === 0) return [];
  const max = candleReversalScanSummaryMaxSymbols();
  const shown = symbols.slice(0, max);
  const tail = symbols.length > max ? ` … (+${symbols.length - max})` : "";
  const joined = shown.join(", ");
  const lines: string[] = [];
  const chunk = 900;
  if (joined.length + indent.length <= chunk) {
    lines.push(`${indent}(${joined}${tail})`);
    return lines;
  }
  lines.push(`${indent}(รายการยาว — แสดงบรรทัดต่อไป)`);
  let rest = `${shown.join(", ")}${tail}`;
  while (rest.length > 0) {
    lines.push(`${indent}${rest.slice(0, chunk)}`);
    rest = rest.slice(chunk);
  }
  return lines;
}

function tfBarDurationSec(tf: CandleReversalTf): number {
  return tf === "1h" ? 3600 : 24 * 3600;
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

export function candleReversalScanSummaryMaxAgeMs(tf: CandleReversalTf): number {
  return tf === "1h" ? 4 * 3600 * 1000 : 2 * 24 * 3600 * 1000;
}

export type CandleReversalTfScanSummaryStats = {
  tf: CandleReversalTf;
  closedBarOpenSec: number | null;
  withPack: number;
  noPack: number;
  skippedBars: number;
  invertedDojiPass: number;
  invertedDojiPassSymbols: string[];
  marubozuPass: number;
  marubozuPassSymbols: string[];
  longestRedPass: number;
  longestRedPassSymbols: string[];
  deduped: number;
  dedupedSymbols: string[];
  cappedByRunLimit: number;
  cappedByRunLimitSymbols: string[];
  sent: number;
  sentSymbols: string[];
  sentByModel: Record<CandleReversalModel, number>;
  errors: string[];
};

export function emptyCandleReversalTfScanSummaryStats(tf: CandleReversalTf): CandleReversalTfScanSummaryStats {
  return {
    tf,
    closedBarOpenSec: null,
    withPack: 0,
    noPack: 0,
    skippedBars: 0,
    invertedDojiPass: 0,
    invertedDojiPassSymbols: [],
    marubozuPass: 0,
    marubozuPassSymbols: [],
    longestRedPass: 0,
    longestRedPassSymbols: [],
    deduped: 0,
    dedupedSymbols: [],
    cappedByRunLimit: 0,
    cappedByRunLimitSymbols: [],
    sent: 0,
    sentSymbols: [],
    sentByModel: { inverted_doji: 0, marubozu: 0, longest_red_body: 0 },
    errors: [],
  };
}

export function pushReversalScanErr(stats: CandleReversalTfScanSummaryStats, line: string): void {
  const s = line.length > 140 ? `${line.slice(0, 137)}...` : line;
  if (stats.errors.length >= 24) return;
  stats.errors.push(s);
}

export function formatCandleReversalScanSummaryMessage(opts: {
  iso: string;
  universeLen: number;
  topAltsCap: number;
  stats: CandleReversalTfScanSummaryStats;
  alertsSentThisTf: number;
  alertCapPerRun: number;
}): string {
  const { iso, universeLen, topAltsCap, stats, alertsSentThisTf, alertCapPerRun } = opts;
  const tf = stats.tf;
  const dur = tfBarDurationSec(tf);
  const barOpen = stats.closedBarOpenSec;
  const lines: string[] = [];

  lines.push(`🧪 Reversal ${tf.toUpperCase()} — สรุปหลังสแกนแท่งปิด`);
  lines.push(`UTC: ${iso}`);
  if (barOpen != null) {
    const barClose = barOpen + dur;
    lines.push(`แท่ง: เปิด ${fmtBkkFromUnixSec(barOpen)} → ปิด ${fmtBkkFromUnixSec(barClose)}`);
  } else {
    lines.push("แท่ง: — (ไม่มี kline อ้างอิงแท่งปิด)");
  }
  lines.push("");
  lines.push("— สแกน —");
  lines.push(`Universe: ${universeLen} สัญญา (top ~${topAltsCap} quote vol)`);
  lines.push(`มี kline: ${stats.withPack}`);
  lines.push(`ไม่มี kline (null): ${stats.noPack}`);
  lines.push(`ข้าม (แท่งไม่พอ): ${stats.skippedBars}`);

  if (tf === "1d") {
    lines.push("");
    lines.push("— 1D โดจิกลับหัว —");
    lines.push(`ครบเกณฑ์ (ก่อน dedupe): ${stats.invertedDojiPass}`);
    lines.push(...formatSymbolListLines("  ", stats.invertedDojiPassSymbols));
    lines.push("");
    lines.push("— 1D แท่งแดงทุบ (Marubozu) —");
    lines.push(`ครบเกณฑ์ (ก่อน dedupe): ${stats.marubozuPass}`);
    lines.push(...formatSymbolListLines("  ", stats.marubozuPassSymbols));
  } else {
    lines.push("");
    lines.push("— 1H แท่งแดงทุบยาว —");
    lines.push(`ครบเกณฑ์ (ก่อน dedupe): ${stats.longestRedPass}`);
    lines.push(...formatSymbolListLines("  ", stats.longestRedPassSymbols));
    lines.push("");
    lines.push("— 1H โดจิกลับหัว —");
    lines.push(`ครบเกณฑ์ (ก่อน dedupe): ${stats.invertedDojiPass}`);
    lines.push(...formatSymbolListLines("  ", stats.invertedDojiPassSymbols));
  }

  lines.push("");
  lines.push("— ส่งแจ้งเตือน —");
  lines.push(`ติด dedupe (เคยส่งแท่งนี้แล้ว): ${stats.deduped}`);
  lines.push(...formatSymbolListLines("  ", stats.dedupedSymbols));
  lines.push(`เกิน cap ต่อรอบ (${alertCapPerRun}/run): ${stats.cappedByRunLimit}`);
  lines.push(...formatSymbolListLines("  ", stats.cappedByRunLimitSymbols));
  lines.push(`ส่ง Telegram สำเร็จ: ${stats.sent} (รอบนี้รวม TF นี้ ${alertsSentThisTf})`);
  lines.push(...formatSymbolListLines("  ", stats.sentSymbols));
  lines.push(
    `  โดจิ ${stats.sentByModel.inverted_doji} · ทุบ ${stats.sentByModel.marubozu} · แดงยาว ${stats.sentByModel.longest_red_body}`,
  );

  if (stats.errors.length > 0) {
    lines.push("");
    lines.push("— errors —");
    for (const e of stats.errors) lines.push(`  • ${e}`);
  }

  lines.push("");
  lines.push("ปิดข้อความนี้: CANDLE_REVERSAL_SCAN_SUMMARY_TO_CHAT=0");
  return lines.join("\n");
}
