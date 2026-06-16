"use client";

import { PendingConflictBadge } from "@/components/PendingConflictBadge";
import { StatsStrategyProfitCell } from "@/components/StatsStrategyProfitCell";
import { candleReversalLookbackRankCell } from "@/lib/candleReversalStatsClient";
import {
  candleReversalEma1hSlopeLabel,
  candleReversalEma4hSlopeLabel,
  candleReversalEma1dSlopeLabel,
} from "@/lib/candleReversalStatsClient";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import {
  statsPsar4hDistPctLabel,
  statsPsar4hTrendLabel,
} from "@/lib/statsPsar4h";
import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  statsStrategyProfitColumnTitle,
} from "@/lib/statsStrategyProfitClient";
import {
  marketSentimentBtcDominanceLabel,
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
  marketSentimentVolChange24hLabel,
} from "@/lib/marketSentiment";
import {
  snowballStatsBarRangePctLabel,
  snowballStatsConfirmVolRankLabel,
  snowballStatsConfirmVolVsSmaLabel,
  snowballStatsEfficiencyScoreLabel,
  snowballStatsVolVsSmaDisplay,
  snowballStatsDayOfWeekBkk,
  snowballStatsHorizonDue,
  snowballStatsBtcPsarCombinedLabel,
  snowballStatsGradeCellClass,
  snowballStatsGradeDisplayLabel,
  snowballStatsGreenDaysLabel,
  snowballStatsSideLabel,
  snowballStatsFundingRateLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsVolScoreLabel,
  snowballStatsVolumeCascadeLabel,
  type SnowballStatsApiPayload,
  type SnowballStatsRow,
  type SnowballStatsSort,
  type SnowballStatsSortKey,
} from "@/lib/snowballStatsClient";
import { snowballTrendGradeCriteriaLegend } from "@/src/snowballTrendGrade";
import type { SnowballStatsEmptyFilterLabels } from "@/components/SnowballStatsFilters";
import { fundingRateVisualClass } from "@/src/marketsFormat";
import type { ReactNode } from "react";

function coinLabel(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u;
}

function formatBkk(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

function fmtPctCell(price: number | null, pct: number | null): ReactNode {
  if (price == null || !Number.isFinite(price)) return "—";
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtPrice(price)} ({fmtPct(pct)})
    </span>
  );
}

function fmtSnowballHorizonCell(
  row: SnowballStatsRow,
  horizonHours: number,
  price: number | null,
  pct: number | null,
): ReactNode {
  if (!snowballStatsHorizonDue(row, horizonHours)) return "-";
  return fmtPctCell(price, pct);
}

function outcomeLabel(o: SnowballStatsRow["outcome"] | "win_quick_tp30"): string {
  if (o === "pending") return "Pending";
  if (o === "win_trend" || o === "win_quick_tp30") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}

function sortMark(active: boolean, dir: SnowballStatsSort["dir"]): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

export function SortTh({
  label,
  sortKey,
  title,
  className,
  activeSort,
  onSort,
}: {
  label: string;
  sortKey: SnowballStatsSortKey;
  title?: string;
  className?: string;
  activeSort: SnowballStatsSort;
  onSort: (key: SnowballStatsSortKey) => void;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th
      scope="col"
      title={title ? `${title} · กดเรียง` : "กดเรียง"}
      className={`sparkStatsSortTh${active ? " sparkStatsSortTh--active" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {sortMark(active, activeSort.dir)}
    </th>
  );
}

type PayloadSlice = Pick<
  SnowballStatsApiPayload,
  "viewerStrategyMarginUsdt" | "viewerStrategyLeverage" | "viewerTpSlPlan"
>;

type Props = {
  tableRows: SnowballStatsRow[];
  allRowsCount: number;
  sort: SnowballStatsSort;
  onSort: (key: SnowballStatsSortKey) => void;
  onGradeDetail: (row: SnowballStatsRow) => void;
  payload?: PayloadSlice | null;
  isAdmin?: boolean;
  showDeleteColumn?: boolean;
  deleteBusy?: boolean;
  onDeleteRow?: (row: SnowballStatsRow) => void;
  emptyFilterLabels: SnowballStatsEmptyFilterLabels;
  emptyMessageNoRows?: string;
};

export function SnowballStatsTable({
  tableRows,
  allRowsCount,
  sort,
  onSort,
  onGradeDetail,
  payload,
  isAdmin = false,
  showDeleteColumn,
  deleteBusy = false,
  onDeleteRow,
  emptyFilterLabels,
  emptyMessageNoRows = "ยังไม่มีแถว — รอสัญญาณ Snowball ส่งสำเร็จและ SNOWBALL_STATS_ENABLED",
}: Props) {
  const showDelete = showDeleteColumn ?? isAdmin;

  return (
    <div className="sparkMatrixScroll">
      <table className="sparkMatrixTable sparkMatrixTable--compact">
        <thead>
          <tr>
            <SortTh
              label="เหรียญ"
              sortKey="symbol"
              className="snowStatsStickyCoin"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh label="ทิศ" sortKey="side" activeSort={sort} onSort={onSort} />
            <SortTh
              label="Grade"
              sortKey="grade"
              className="snowStatsStickyGrade"
              title={`เกรดสุทธิ (S/A/B/C/F) — ${snowballTrendGradeCriteriaLegend()} — คลิกแถวดูรายละเอียด`}
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh label="วัน" sortKey="day" activeSort={sort} onSort={onSort} />
            <SortTh label="เวลา (BKK)" sortKey="time" activeSort={sort} onSort={onSort} />
            <SortTh label="Entry" sortKey="entry" activeSort={sort} onSort={onSort} />
            <SortTh label="Range" sortKey="range" activeSort={sort} onSort={onSort} />
            <SortTh label="Wick" sortKey="wick" activeSort={sort} onSort={onSort} />
            <SortTh
              label="Len#"
              sortKey="lenRank"
              title="อันดับความยาวแท่ง (high-low) ในรอบ lookback — 1 = ยาวสุด"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Len%"
              sortKey="lenPct"
              title="Len percentile — 100% = ยาวสุดในรอบ lookback"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh label="R% ก่อน" sortKey="barRangePrev" activeSort={sort} onSort={onSort} />
            <SortTh label="R% สัญญาณ" sortKey="barRangeSignal" activeSort={sort} onSort={onSort} />
            <SortTh label="R% 2แท่ง" sortKey="barRange2Sum" activeSort={sort} onSort={onSort} />
            <SortTh
              label="BTC SAR"
              sortKey="btcPsar"
              title="BTC PSAR — แท่ง 4h และ 1h ปิดล่าสุด (Binance)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Vol 24h"
              sortKey="vol24"
              title="Quote volume 24h USDT (Binance perp · fallback MEXC amount24) ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Mcap"
              sortKey="mcap"
              title="Market cap USD (CoinGecko) ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="ATR%14D"
              sortKey="atr14d"
              title="Wilder ATR(14) บน 1d ÷ close × 100 — สูง = แกว่งเร็ว"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="EMA1h∠7d"
              sortKey="ema1h"
              title="EMA(12) 1h slope % ย้อนหลัง 7 วัน (168 แท่ง)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="EMA4h∠7d"
              sortKey="ema4h"
              title="EMA(12) 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="EMA1d∠7d"
              sortKey="ema1d"
              title="EMA(12) 1d slope % ย้อนหลัง 7 แท่ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="BTC∠4h"
              sortKey="btcEma4h"
              title="BTC EMA(12) 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="BTC∠1d"
              sortKey="btcEma1d"
              title="BTC EMA(12) 1d slope % ย้อนหลัง 7 แท่ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="SAR 4h"
              sortKey="psar4h"
              title="Parabolic SAR 4h ของคู่สัญญาณ — ↑ = bullish · ↓ = bearish (ไม่ใช่ BTC SAR)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="SAR dist%"
              sortKey="psar4hDist"
              title="(close − SAR) / close × 100 บน 4h — บวก = ราคาเหนือ SAR"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Funding"
              sortKey="funding"
              title="Funding rate สัญญา MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม ×100 = %)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Vol↗"
              sortKey="volCascade"
              title="Vol cascade — volume 5 แท่ง 1H ล่าสุด ยอมไม่ยกฐานได้ 1 ครั้ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="เขียว"
              sortKey="greenDays"
              title="แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ Snowball"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="เขียว(BKK)"
              sortKey="greenDaysBkk"
              title="เขียวตามวันปฏิทิน BKK — แท่ง Day1 เขียวติดก่อนวันสัญญาณ"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Vol×SMA"
              sortKey="volVsSma"
              title="4h = Vol แท่งสัญญาณ ÷ SMA(4H) · อื่นๆ = 1H confirm หรือ signal"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Eff Score"
              sortKey="efficiencyScore"
              title="Efficiency Score = R% 2แท่ง ÷ Vol×SMA"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Vol rank"
              sortKey="volRank"
              title="อันดับ vol 1H จาก breakout confirm eval"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh label="4h" sortKey="h4" activeSort={sort} onSort={onSort} />
            <SortTh label="12h" sortKey="h12" activeSort={sort} onSort={onSort} />
            <SortTh label="24h" sortKey="h24" activeSort={sort} onSort={onSort} />
            <SortTh label="48h" sortKey="h48" activeSort={sort} onSort={onSort} />
            <SortTh label="Max ROI" sortKey="maxRoi" activeSort={sort} onSort={onSort} />
            <SortTh label="Duration→MFE" sortKey="durationMfe" activeSort={sort} onSort={onSort} />
            <SortTh
              label="Max DD ก่อน"
              sortKey="signalMaxDd"
              title="Max DD ก่อนแจ้ง — 15m ย้อนหลัง 32 แท่ง (8 ชม.)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Max DD หลัง"
              sortKey="maxDrawdown"
              title="Max DD หลังแจ้ง — adverse สูงสุดถึง MFE (24h)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Adv max"
              sortKey="followUpAdverse"
              title="Max adverse ตลอดช่วง follow-up 48h"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh label="SVP Hole" sortKey="svpHole" activeSort={sort} onSort={onSort} />
            <SortTh label="RR" sortKey="resultRr" activeSort={sort} onSort={onSort} />
            <SortTh
              label="F&G"
              sortKey="fng"
              title="Fear & Greed (Market Pulse snapshot ณ เวลาแจ้ง)"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="Sentiment"
              sortKey="sentiment"
              title="Sentiment จาก F&G — Bullish / Neutral / Bearish"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="BTC.D"
              sortKey="btcDom"
              title="BTC dominance % ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="VolΔ24h"
              sortKey="volChange24h"
              title="การเปลี่ยนแปลง vol โดยประมาณ 24h"
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="กำไรกลยุทธ์ 24h"
              sortKey="strategyProfit24h"
              title={
                payload?.viewerTpSlPlan
                  ? statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_24H, payload.viewerTpSlPlan)
                  : statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_24H)
              }
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="กำไรกลยุทธ์ 48h"
              sortKey="strategyProfit48h"
              title={
                payload?.viewerTpSlPlan
                  ? statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_48H, payload.viewerTpSlPlan)
                  : statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_48H)
              }
              activeSort={sort}
              onSort={onSort}
            />
            <SortTh
              label="ผล @48h"
              sortKey="outcome"
              title="ปิดผลที่ 48h จาก pct48h (Win ≥ +3% · Loss ≤ -3%)"
              activeSort={sort}
              onSort={onSort}
            />
            {showDelete ? <th scope="col" className="snowStatsDelCol" aria-label="ลบ" /> : null}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr>
              <td colSpan={showDelete ? 45 : 44} className="sub">
                {allRowsCount === 0
                  ? emptyMessageNoRows
                  : `ไม่มีแถวที่ตรงกับ filter — ลองเลือก ทั้งหมด / ทุกทิศ / ทุก grade / เขียว ${emptyFilterLabels.greenDays} / Funding ${emptyFilterLabels.funding} / โครงสร้าง ${emptyFilterLabels.structure} / BTC SAR ${emptyFilterLabels.btcPsar} / Matrix ${emptyFilterLabels.matrix} / EMA1h ${emptyFilterLabels.ema1h} / EMA4h ${emptyFilterLabels.ema4h} / EMA1d ${emptyFilterLabels.ema1d} / BTC∠4h ${emptyFilterLabels.btcEma4h} / ATR ${emptyFilterLabels.atr} / Vol×SMA ${emptyFilterLabels.volVsSma} / R% ก่อน ${emptyFilterLabels.barRangePrev} / R% 2แท่ง ${emptyFilterLabels.barRange2} / Efficiency ${emptyFilterLabels.efficiency} / Max DD ก่อน ${emptyFilterLabels.signalMaxDd} / Vol rank ${emptyFilterLabels.volRank}`}
              </td>
            </tr>
          ) : (
            tableRows.map((r) => (
              <tr key={r.id}>
                <td className="snowStatsStickyCoin">
                  {coinLabel(r.symbol)}
                  <PendingConflictBadge conflictWith={r.conflictWith} />
                </td>
                <td>{snowballStatsSideLabel(r)}</td>
                <td className={`snowStatsStickyGrade ${snowballStatsGradeCellClass(r)}`}>
                  <button
                    type="button"
                    className="snowGradeCellBtn"
                    title="ดูโครงสร้างและเหตุผลเกรด"
                    onClick={() => onGradeDetail(r)}
                  >
                    {snowballStatsGradeDisplayLabel(r)}
                  </button>
                </td>
                <td>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {snowballStatsDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}
                  </span>
                </td>
                <td>
                  <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                </td>
                <td>{fmtPrice(r.entryPrice)}</td>
                <td>{snowballStatsVolScoreLabel(r.rangeScore)}</td>
                <td>{snowballStatsVolScoreLabel(r.wickScore)}</td>
                <td>{candleReversalLookbackRankCell(r.rangeRankInLookback, r.lenLookbackBars)}</td>
                <td title="Len percentile">{statsLenPercentileLabel(r.lenPercentilePct)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePctPrev)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePctSignal)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePct2Sum)}</td>
                <td>{snowballStatsBtcPsarCombinedLabel(r.btcPsar4hTrend, r.btcPsar1hTrend)}</td>
                <td>{snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt)}</td>
                <td>{snowballStatsMarketCapUsdLabel(r.marketCapUsd)}</td>
                <td>{statsAtrPct14dLabel(r.atrPct14d)}</td>
                <td title="EMA(12) 1h slope 7d">{candleReversalEma1hSlopeLabel(r.ema1hSlopePct7d)}</td>
                <td title="EMA(12) 4h slope 7d">{candleReversalEma4hSlopeLabel(r.ema4hSlopePct7d)}</td>
                <td title="EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.ema1dSlopePct7d)}</td>
                <td title="BTC EMA(12) 4h slope 7d">{candleReversalEma4hSlopeLabel(r.btcEma4hSlopePct7d)}</td>
                <td title="BTC EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.btcEma1dSlopePct7d)}</td>
                <td title="PSAR 4h trend">{statsPsar4hTrendLabel(r.psar4hTrend)}</td>
                <td title="PSAR 4h distance">{statsPsar4hDistPctLabel(r.psar4hDistPct)}</td>
                <td
                  className={
                    r.fundingRate != null && Number.isFinite(r.fundingRate)
                      ? fundingRateVisualClass(r.fundingRate)
                      : undefined
                  }
                >
                  {snowballStatsFundingRateLabel(r.fundingRate)}
                </td>
                <td>{snowballStatsVolumeCascadeLabel(r.volumeCascadeYn)}</td>
                <td>{snowballStatsGreenDaysLabel(r.greenDaysBeforeSignal)}</td>
                <td>{snowballStatsGreenDaysLabel(r.greenDaysBeforeSignalBkk)}</td>
                <td>{snowballStatsConfirmVolVsSmaLabel(snowballStatsVolVsSmaDisplay(r))}</td>
                <td title="Efficiency Score = R% 2แท่ง ÷ Vol×SMA">
                  {snowballStatsEfficiencyScoreLabel(r)}
                </td>
                <td>{snowballStatsConfirmVolRankLabel(r.confirmVolRank, r.confirmVolRankLb)}</td>
                <td>{fmtSnowballHorizonCell(r, 4, r.price4h, r.pct4h)}</td>
                <td>{fmtSnowballHorizonCell(r, 12, r.price12h, r.pct12h)}</td>
                <td>{fmtSnowballHorizonCell(r, 24, r.price24h, r.pct24h)}</td>
                <td>{fmtSnowballHorizonCell(r, 48, r.price48h, r.pct48h)}</td>
                <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                <td>
                  {r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
                    ? `${r.durationToMfeHours.toFixed(2)}h`
                    : "—"}
                </td>
                <td>
                  {r.signalMaxDdPct != null && Number.isFinite(r.signalMaxDdPct)
                    ? `${r.signalMaxDdPct.toFixed(2)}%`
                    : "—"}
                </td>
                <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                <td>
                  {r.followUpMaxAdversePct != null ? `${r.followUpMaxAdversePct.toFixed(2)}%` : "—"}
                </td>
                <td>{r.svpHoleYn}</td>
                <td>{r.resultRr ?? "—"}</td>
                <td>{marketSentimentFngLabel(r.marketSentiment)}</td>
                <td>{marketSentimentSentimentLabel(r.marketSentiment)}</td>
                <td>{marketSentimentBtcDominanceLabel(r.marketSentiment)}</td>
                <td>{marketSentimentVolChange24hLabel(r.marketSentiment)}</td>
                <td>
                  <StatsStrategyProfitCell
                    holdHours={STATS_STRATEGY_PROFIT_HOLD_24H}
                    pct24h={r.pct24h}
                    pct48h={r.pct48h}
                    strategyProfitPct24h={r.strategyProfitPct24h}
                    strategyExitReason24h={r.strategyExitReason24h}
                    marginUsdt={payload?.viewerStrategyMarginUsdt}
                    leverage={payload?.viewerStrategyLeverage}
                    tpSlPlan={payload?.viewerTpSlPlan}
                    maxDrawdownPct={r.maxDrawdownPct}
                    followUpMaxAdversePct={r.followUpMaxAdversePct}
                  />
                </td>
                <td>
                  <StatsStrategyProfitCell
                    holdHours={STATS_STRATEGY_PROFIT_HOLD_48H}
                    pct24h={r.pct24h}
                    pct48h={r.pct48h}
                    strategyProfitPct={r.strategyProfitPct}
                    strategyExitReason={r.strategyExitReason}
                    marginUsdt={payload?.viewerStrategyMarginUsdt}
                    leverage={payload?.viewerStrategyLeverage}
                    tpSlPlan={payload?.viewerTpSlPlan}
                    maxDrawdownPct={r.maxDrawdownPct}
                    followUpMaxAdversePct={r.followUpMaxAdversePct}
                  />
                </td>
                <td>{outcomeLabel(r.outcome)}</td>
                {showDelete && onDeleteRow ? (
                  <td className="snowStatsDelCol">
                    <button
                      type="button"
                      className="snowStatsRowDelBtn"
                      title="ลบแถวนี้"
                      disabled={deleteBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteRow(r);
                      }}
                    >
                      ลบ
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
