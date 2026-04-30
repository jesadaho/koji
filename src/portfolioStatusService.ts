import { computeEmaLast } from "./emaUtils";
import {
  fetchAllOpenPositions,
  fetchContractDetailPublic,
  fetchFuturesAccountAssetList,
  getContractLastPricePublic,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { fetchPerp15mClosesForChecklist } from "./mexcMarkets";

function numFromUnknown(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatPctSigned(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatBkkNow(): string {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} (BKK)`;
}

function portfolioInterSymbolDelayMs(): number {
  const n = Number(process.env.MEXC_TICKER_INTER_SYMBOL_DELAY_MS?.trim());
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.floor(n) : 50;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Display MEXC marginRatio: small decimals become %, larger values treated as already %-like */
export function formatMarginRatioDisplay(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return "—";
  if (r >= 0 && r <= 1) return `${(r * 100).toFixed(2)}%`;
  return `${r.toFixed(2)}%`;
}

function contractSymbolToLabel(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const m = s.match(/^(.+)_USDT$/);
  return m ? `${m[1]}/USDT` : symbol;
}

function isLongPosition(p: OpenPositionRow): boolean {
  return p.positionType === 1;
}

/** Exported for sanity checks and tests */
export function describeSwingStructureFromCloses(closes: number[]): string {
  if (closes.length < 5) return "— (แท่งไม่พอ)";
  const tail = closes.slice(-24);
  const pivotsH: number[] = [];
  const pivotsL: number[] = [];
  for (let i = 1; i < tail.length - 1; i++) {
    const c = tail[i]!;
    if (c > tail[i - 1]! && c > tail[i + 1]!) pivotsH.push(c);
    if (c < tail[i - 1]! && c < tail[i + 1]!) pivotsL.push(c);
  }
  const hh = pivotsH.slice(-2);
  const ll = pivotsL.slice(-2);
  const parts: string[] = [];
  if (hh.length >= 2) {
    if (hh[1]! > hh[0]!) parts.push("Higher high");
    else if (hh[1]! < hh[0]!) parts.push("Lower high");
  }
  if (ll.length >= 2) {
    if (ll[1]! > ll[0]!) parts.push("Higher low");
    else if (ll[1]! < ll[0]!) parts.push("Lower low");
  }
  if (parts.length === 0) return "Range / ไม่ชัด (heuristic)";
  return `${parts.join(" · ")} (heuristic)`;
}

function describeEma12Proxy(long: boolean, mark: number, ema12: number | null): { line: string; distPct: number | null } {
  if (ema12 == null || !(mark > 0)) {
    return { line: "EMA12: —", distPct: null };
  }
  const dist = ((mark - ema12) / mark) * 100;
  if (long) {
    if (mark >= ema12) {
      return {
        line: `เหนือ EMA12 (support proxy) · ห่างจาก EMA12 ${formatPctSigned(dist)}`,
        distPct: dist,
      };
    }
    return {
      line: `ใต้ EMA12 (resistance proxy) · ห่างจาก EMA12 ${formatPctSigned(dist)}`,
      distPct: dist,
    };
  }
  if (mark <= ema12) {
    return {
      line: `ใต้ EMA12 (resistance proxy) · ห่างจาก EMA12 ${formatPctSigned(-dist)}`,
      distPct: -dist,
    };
  }
  return {
    line: `เหนือ EMA12 (สวนทางงานสั้น ๆ ได้) · ห่างจาก EMA12 ${formatPctSigned(-dist)}`,
    distPct: -dist,
  };
}

type PositionMetrics = {
  row: OpenPositionRow;
  symbol: string;
  label: string;
  long: boolean;
  mark: number | null;
  avg: number | null;
  contractSize: number | null;
  unrealized: number | null;
  pnlPctOnMargin: number | null;
  liqDistPct: number | null;
  ema12: number | null;
  ema6: number | null;
  emaLine: string;
  structureLine: string;
  concerns: string[];
};

function computeLiqDistancePct(p: OpenPositionRow, mark: number): number | null {
  const liq = numFromUnknown(p.liquidatePrice);
  if (liq == null || !(liq > 0) || !(mark > 0)) return null;
  const isolated = p.openType === 1;
  if (!isolated) return null;
  if (isLongPosition(p)) {
    if (liq >= mark) return null;
    return ((mark - liq) / mark) * 100;
  }
  if (liq <= mark) return null;
  return ((liq - mark) / mark) * 100;
}

function splitForTelegram(body: string, maxLen = 4096): string[] {
  if (body.length <= maxLen) return [body];
  const lines = body.split("\n");
  const out: string[] = [];
  let buf = "";
  const pushBuf = () => {
    const t = buf.trimEnd();
    if (t) out.push(t);
    buf = "";
  };
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > maxLen) {
      pushBuf();
      if (line.length > maxLen) {
        let rest = line;
        while (rest.length > maxLen) {
          out.push(rest.slice(0, maxLen));
          rest = rest.slice(maxLen);
        }
        buf = rest;
      } else {
        buf = line;
      }
    } else {
      buf = candidate;
    }
  }
  pushBuf();
  return out.length ? out : [body.slice(0, maxLen)];
}

async function buildPositionMetrics(
  p: OpenPositionRow,
  leadDelayMs: number
): Promise<PositionMetrics> {
  if (leadDelayMs > 0) await sleep(leadDelayMs);

  const symbol = p.symbol.trim();
  const label = contractSymbolToLabel(symbol);
  const long = isLongPosition(p);
  const concerns: string[] = [];

  const [detail, markPx, closes] = await Promise.all([
    fetchContractDetailPublic(symbol),
    getContractLastPricePublic(symbol),
    fetchPerp15mClosesForChecklist(symbol),
  ]);

  const cs = detail?.contractSize != null ? Number(detail.contractSize) : NaN;
  const contractSize = Number.isFinite(cs) && cs > 0 ? cs : null;

  const mark = markPx != null && markPx > 0 ? markPx : null;
  const avgRaw = numFromUnknown(p.holdAvgPrice) ?? numFromUnknown(p.openAvgPrice);
  const avg = avgRaw != null && avgRaw > 0 ? avgRaw : null;
  const vol = Number(p.holdVol);
  const volOk = Number.isFinite(vol) && vol > 0;

  let unrealized: number | null = null;
  if (mark != null && avg != null && volOk && contractSize != null) {
    const dir = long ? 1 : -1;
    unrealized = dir * (mark - avg) * vol * contractSize;
  }

  const im = numFromUnknown(p.im) ?? numFromUnknown(p.oim);
  let pnlPctOnMargin: number | null = null;
  if (unrealized != null && im != null && im > 0) {
    pnlPctOnMargin = (unrealized / im) * 100;
  } else if (unrealized != null && mark != null && volOk && contractSize != null) {
    const notional = vol * contractSize * mark;
    if (notional > 0) pnlPctOnMargin = (unrealized / notional) * 100;
  }

  const liqDistPct = mark != null ? computeLiqDistancePct(p, mark) : null;
  if (liqDistPct != null && liqDistPct < 5) {
    concerns.push(`ใกล้ราคา liquidation (~${liqDistPct.toFixed(2)}% ตามมาร์ก)`);
  }

  const ema12 = closes ? computeEmaLast(closes, 12) : null;
  const ema6 = closes ? computeEmaLast(closes, 6) : null;
  const emaDesc = describeEma12Proxy(long, mark ?? avg ?? 1, ema12);
  if (mark != null && ema12 != null) {
    if (long && mark < ema12) concerns.push("ราคาใต้ EMA12 — งาน long กดแรง (proxy)");
    if (!long && mark > ema12) concerns.push("ราคาเหนือ EMA12 — งาน short กดแรง (proxy)");
  }

  const structureLine = closes ? describeSwingStructureFromCloses(closes) : "—";

  return {
    row: p,
    symbol,
    label,
    long,
    mark,
    avg,
    contractSize,
    unrealized,
    pnlPctOnMargin,
    liqDistPct,
    ema12,
    ema6,
    emaLine: emaDesc.line,
    structureLine,
    concerns,
  };
}

function formatPositionBlock(m: PositionMetrics): string {
  const side = m.long ? "LONG" : "SHORT";
  const icon = m.unrealized != null && m.unrealized >= 0 ? "🟢" : "🔴";
  const pnlPart =
    m.pnlPctOnMargin != null ? `PnL: ${formatPctSigned(m.pnlPctOnMargin)} (บนมาร์จ)` : "PnL: —";
  const symCompact = m.label.replace("/", "");
  const head = `${icon} ${side} ${symCompact} | ${pnlPart}`;

  const lines: string[] = [head, `📉 Position Health: [${side}] ${m.label}`];

  lines.push(`Current Price: ${m.mark != null ? formatPriceCompact(m.mark) : "—"}`);
  if (m.avg != null) lines.push(`Avg entry: ${formatPriceCompact(m.avg)}`);
  if (m.row.leverage != null) lines.push(`Leverage: ${m.row.leverage}x`);
  lines.push(`EMA12 (15m proxy, ไม่ใช่เส้น TV): ${m.emaLine}`);
  if (m.ema6 != null && m.ema12 != null) {
    lines.push(`EMA6 / EMA12: ${formatPriceCompact(m.ema6)} / ${formatPriceCompact(m.ema12)}`);
  }
  lines.push(`Structure: ${m.structureLine}`);
  if (m.row.openType === 1 && m.liqDistPct != null) {
    lines.push(`Distance to liq. (isolated): ~${m.liqDistPct.toFixed(2)}%`);
  } else if (m.row.openType === 2) {
    lines.push(`Mode: cross margin (ไม่มี liq เดี่ยวในแถวนี้)`);
  }
  lines.push(`Position margin ratio: ${formatMarginRatioDisplay(numFromUnknown(m.row.marginRatio))}`);
  if (m.unrealized != null) lines.push(`Unrealized (est.): ${formatUsd(m.unrealized)}`);

  if (m.concerns.length > 0) {
    lines.push("");
    lines.push("⚠️ Concern:");
    for (const c of m.concerns) lines.push(`• ${c}`);
  }

  return lines.join("\n");
}

function formatPriceCompact(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 1) return p.toFixed(6);
  if (p < 100) return p.toFixed(4);
  if (p < 1000) return p.toFixed(2);
  return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * สรุปพอร์ตฟิวเจอร์ MEXC + context EMA15m (proxy) ต่อ position
 * คืนหลายข้อความถ้ายาวเกิน Telegram 4096
 */
export async function buildTelegramPortfolioStatusMessages(creds: MexcCredentials): Promise<string[]> {
  const [assetsRes, posRes] = await Promise.all([
    fetchFuturesAccountAssetList(creds),
    fetchAllOpenPositions(creds),
  ]);

  if (!assetsRes.ok) {
    return [
      `❌ อ่านทรัพย์สินฟิวเจอร์ไม่สำเร็จ\nรหัส: ${assetsRes.code ?? "?"}\n${assetsRes.message.slice(0, 600)}`,
    ];
  }
  if (!posRes.ok) {
    return [
      `❌ อ่าน open positions ไม่สำเร็จ\nรหัส: ${posRes.code ?? "?"}\n${posRes.message.slice(0, 600)}`,
    ];
  }

  const usdt = assetsRes.rows.find((r) => String(r.currency ?? "").toUpperCase() === "USDT");
  const equity = numFromUnknown(usdt?.equity);
  const available = numFromUnknown(usdt?.availableBalance);
  const unrealizedWallet = numFromUnknown(usdt?.unrealized);
  const positionMargin = numFromUnknown(usdt?.positionMargin);

  const actives = posRes.rows.filter((p) => p.state === 1 && Number(p.holdVol) > 0);
  const delayMs = portfolioInterSymbolDelayMs();

  const metricsList: PositionMetrics[] = [];
  for (let i = 0; i < actives.length; i++) {
    const m = await buildPositionMetrics(actives[i]!, i === 0 ? 0 : delayMs);
    metricsList.push(m);
  }

  let sumUnrealized = 0;
  let anyUnreal = false;
  for (const m of metricsList) {
    if (m.unrealized != null) {
      sumUnrealized += m.unrealized;
      anyUnreal = true;
    }
  }

  const floatingUsd = unrealizedWallet != null ? unrealizedWallet : anyUnreal ? sumUnrealized : null;
  const floatingPct =
    floatingUsd != null && equity != null && equity > 0 ? (floatingUsd / equity) * 100 : null;

  const marginUsePct =
    positionMargin != null && equity != null && equity > 0 ? (positionMargin / equity) * 100 : null;

  let maxPosMarginRatio: number | null = null;
  for (const m of metricsList) {
    const r = numFromUnknown(m.row.marginRatio);
    if (r != null && Number.isFinite(r)) {
      maxPosMarginRatio = maxPosMarginRatio == null ? r : Math.max(maxPosMarginRatio, r);
    }
  }

  metricsList.sort((a, b) => {
    const ax = a.unrealized != null ? Math.abs(a.unrealized) : 0;
    const bx = b.unrealized != null ? Math.abs(b.unrealized) : 0;
    return bx - ax;
  });

  const headerLines = [
    "🛡️ PORTFOLIO HEALTH",
    `⏱ ${formatBkkNow()}`,
    "(i) EMA / structure = proxy จากแท่ง 15m — ไม่ใช่เส้น Trendline ใน TradingView",
    "",
    `💰 Balance (equity): ${formatUsd(equity)}`,
    `💵 Available: ${formatUsd(available)}`,
    `📉 Floating PnL: ${floatingUsd != null ? `${formatUsd(floatingUsd)} (${formatPctSigned(floatingPct)})` : "—"}`,
    marginUsePct != null ? `⚡ Margin use (posMargin/equity): ${formatPctSigned(marginUsePct)}` : "⚡ Margin use: —",
    `⚡ Max position margin ratio: ${formatMarginRatioDisplay(maxPosMarginRatio)}`,
    "",
    `Open positions: ${actives.length}`,
  ];

  if (actives.length === 0) {
    const body = headerLines.join("\n");
    return splitForTelegram(body);
  }

  const blocks = metricsList.map(formatPositionBlock);
  const body = [...headerLines, "", "Positions:", "", blocks.join("\n\n")].join("\n");
  return splitForTelegram(body);
}
