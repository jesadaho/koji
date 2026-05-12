import {
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
} from "./binanceIndicatorKline";
import { loadPriceSyncCronRecord } from "./cronStatusStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  getIndicatorPublicScanParams,
  isIndicatorPublicFeedEnabled,
  isPublicSnowballTripleCheckEnabled,
  publicRsiDivergenceTfs,
  publicRsiEmaCrossTf,
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

  let out = lines.join("\n");
  if (out.length > MAX_OUT) out = `${out.slice(0, MAX_OUT - 20)}\n…(truncated)`;
  return out;
}
