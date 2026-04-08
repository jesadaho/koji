"use client";

import { useMemo, useState } from "react";
import type { MarketsSortMode, TopMarketRow } from "@/src/mexcMarkets";
import FundingHistoryButton from "@/components/FundingHistoryButton";
import {
  formatFunding,
  formatFundingCycleHours,
  formatPrice,
  formatScore,
  formatUsd,
  fundingSettleTitle,
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
                <th className="num">Funding</th>
                <th className="num" title="collectCycle (ชม.) จาก MEXC funding_rate">
                  รอบ
                </th>
                <th className="num" title="ประมาณ notional USDT (สัญญา × ราคา) จาก tier สูงสุด">
                  Max pos (USDT)
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const up = r.change24hPercent >= 0;
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
                    <td className="num marketsCellFunding" data-label="Funding">
                      <span className="marketsFundingValue">{formatFunding(r.fundingRate)}</span>
                      {marketsSort === "funding" ? <FundingHistoryButton symbol={r.symbol} /> : null}
                    </td>
                    <td
                      className="num"
                      data-label="รอบ"
                      title={fundingSettleTitle(r.nextFundingSettleMs)}
                    >
                      {formatFundingCycleHours(r.fundingCycleHours)}
                    </td>
                    <td
                      className="num"
                      data-label="Max pos"
                      title={
                        r.maxPositionContracts != null
                          ? `≈ สัญญา × ราคา (USDT-M) · สัญญาสูงสุด ${r.maxPositionContracts.toLocaleString("en-US")} สัญญา`
                          : "ไม่มีข้อมูล tier / limit"
                      }
                    >
                      {r.maxPositionUsdt != null ? formatUsd(r.maxPositionUsdt) : "—"}
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
