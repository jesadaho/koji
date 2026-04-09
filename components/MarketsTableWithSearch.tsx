"use client";

import { useMemo, useState } from "react";
import type { MarketsSortMode, TopMarketRow } from "@/src/mexcMarkets";
import FundingHistoryButton from "@/components/FundingHistoryButton";
import {
  formatFunding,
  formatPrice,
  formatScore,
  formatUsd,
  fundingRateVisualClass,
  fundingSettleTitle,
  maxPositionWarnThreshold,
} from "@/src/marketsFormat";

type Props = {
  rows: TopMarketRow[];
  showDebugColumns: boolean;
  marketsSort: MarketsSortMode;
};

function symbolMatches(symbol: string, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return symbol.toLowerCase().includes(t);
}

export default function MarketsTableWithSearch({ rows, showDebugColumns, marketsSort }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((r) => symbolMatches(r.symbol, query)),
    [rows, query],
  );
  const trimmed = query.trim();

  const maxPosWarnBelow = useMemo(
    () => maxPositionWarnThreshold(filtered.map((r) => r.maxPositionUsdt)),
    [filtered],
  );

  return (
    <>
      <div className="marketsSearchBar">
        <label htmlFor="markets-search" className="marketsSearchLabel">
          ค้นหา
        </label>
        <input
          id="markets-search"
          type="search"
          className="marketsSearchInput"
          placeholder="สัญญา เช่น BTC, ETH_USDT"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {trimmed ? (
          <span className="marketsSearchCount" aria-live="polite">
            {filtered.length}/{rows.length}
          </span>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <p className="sub marketsSearchEmpty">
          {trimmed ? `ไม่พบสัญญาที่ตรงกับ «${trimmed}»` : "ไม่มีข้อมูล"}
        </p>
      ) : (
        <div className="marketsTableWrap">
          <table className="marketsTable">
            <thead>
              <tr>
                <th>สัญญา</th>
                {showDebugColumns ? (
                  <>
                    <th className="num" title="(V_recent/V_avg)×(ΔP/P)">
                      Score
                    </th>
                    <th className="num" title="Volume แท่ง 15m ปิดล่าสุด / เฉลี่ยแท่งก่อนหน้า">
                      Vol×
                    </th>
                    <th className="num">15m</th>
                  </>
                ) : null}
                <th className="num">ราคา</th>
                <th className="num">24h</th>
                <th className="num">Vol 24h (USDT)</th>
                <th
                  className="num marketsThFunding"
                  title="Funding rate จาก ticker — สีสะท้อนต้นทุนถือสถานะ"
                >
                  <span className="marketsThIcon" aria-hidden>
                    💹
                  </span>{" "}
                  Funding
                </th>
                <th
                  className="num marketsThCycle"
                  title="รอบจ่าย funding (ชม.) — collectCycle จาก contract/funding_rate"
                >
                  <span className="marketsThIcon" aria-hidden>
                    🕒
                  </span>{" "}
                  Cycle
                </th>
                <th className="num marketsThMaxPos" title="ประมาณ notional USDT สูงสุดจาก tier — สะท้อนสภาพคล่อง">
                  <span className="marketsThIcon" aria-hidden>
                    📦
                  </span>{" "}
                  Max pos
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const up = r.change24hPercent >= 0;
                const fundingCls = fundingRateVisualClass(r.fundingRate);
                const maxLowLiquidity =
                  r.maxPositionUsdt != null &&
                  maxPosWarnBelow != null &&
                  r.maxPositionUsdt <= maxPosWarnBelow;
                return (
                  <tr key={r.symbol}>
                    <td data-label="สัญญา" className="marketsCellSymbol">
                      <code>{r.symbol}</code>
                    </td>
                    {showDebugColumns ? (
                      <>
                        <td className="num" data-label="Score">
                          {formatScore(r.momentumScore)}
                        </td>
                        <td className="num" data-label="Vol×">
                          {r.volumeSpikeRatio.toFixed(2)}×
                        </td>
                        <td
                          className={`num ${r.return15mPercent >= 0 ? "changeUp" : "changeDown"}`}
                          data-label="15m"
                        >
                          {r.return15mPercent >= 0 ? "+" : ""}
                          {r.return15mPercent.toFixed(2)}%
                        </td>
                      </>
                    ) : null}
                    <td className="num" data-label="ราคา">
                      {formatPrice(r.lastPrice)}
                    </td>
                    <td className={`num ${up ? "changeUp" : "changeDown"}`} data-label="24h">
                      {up ? "+" : ""}
                      {r.change24hPercent.toFixed(2)}%
                    </td>
                    <td className="num" data-label="Vol 24h">
                      {formatUsd(r.amount24Usdt)}
                    </td>
                    <td
                      className={`num marketsCellFundingRate marketsFundingRate--${fundingCls}`}
                      data-label="Funding"
                      title="ค่าธรรมเนียมถือสถานะ (ต่อรอบ) — บวกมาก = ฝั่ง long จ่ายหนัก"
                    >
                      <div className="marketsCellFundingRateInner">
                        <span>
                          <span className="marketsMetricIcon" aria-hidden>
                            💹
                          </span>
                          <span className="marketsFundingRateText">{formatFunding(r.fundingRate)}</span>
                        </span>
                        {marketsSort === "funding" ? <FundingHistoryButton symbol={r.symbol} /> : null}
                      </div>
                    </td>
                    <td
                      className="num marketsCellFundingCycle"
                      data-label="Cycle"
                      title={fundingSettleTitle(r.nextFundingSettleMs) ?? "รอบจ่าย funding (ชม.)"}
                    >
                      <span className="marketsMetricIcon" aria-hidden>
                        🕒
                      </span>
                      <span className="marketsFundingCycleText">
                        {r.fundingCycleHours != null && r.fundingCycleHours > 0
                          ? `${r.fundingCycleHours}h`
                          : "—"}
                      </span>
                    </td>
                    <td
                      className={`num marketsCellMaxPos${maxLowLiquidity ? " marketsCellMaxPos--warn" : ""}`}
                      data-label="Max pos"
                      title={
                        maxLowLiquidity
                          ? "ขนาดไม้สูงสุดต่ำเมื่อเทียบกับคู่อื่นในตาราง — ระวังสภาพคล่อง"
                          : r.maxPositionContracts != null
                            ? `≈ สัญญา × ราคา (USDT-M) · สัญญาสูงสุด ${r.maxPositionContracts.toLocaleString("en-US")} สัญญา`
                            : "ไม่มีข้อมูล tier / limit"
                      }
                    >
                      <span className="marketsMetricIcon" aria-hidden>
                        {maxLowLiquidity ? "⚠️" : "📦"}
                      </span>
                      <span className="marketsMaxPosValue">
                        {r.maxPositionUsdt != null ? formatUsd(r.maxPositionUsdt) : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
