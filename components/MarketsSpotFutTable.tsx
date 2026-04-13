"use client";

import { useMemo, useState } from "react";
import type { SpotFutBasisRow } from "@/src/mexcMarkets";
import {
  formatFunding,
  formatPrice,
  formatUsd,
  fundingRateVisualClass,
  maxPositionWarnThreshold,
} from "@/src/marketsFormat";

type Props = {
  rows: SpotFutBasisRow[];
};

function symbolMatches(symbol: string, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return symbol.toLowerCase().includes(t);
}

export default function MarketsSpotFutTable({ rows }: Props) {
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
        <label htmlFor="markets-spotfut-search" className="marketsSearchLabel">
          ค้นหา
        </label>
        <input
          id="markets-spotfut-search"
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
                <th className="num">Spot</th>
                <th className="num">Perp</th>
                <th className="num" title="(Perp − Spot) / Spot × 100">
                  Basis %
                </th>
                <th className="num">24h</th>
                <th className="num">Vol 24h (USDT)</th>
                <th className="num" title="Funding rate จาก contract ticker">
                  💹 Funding
                </th>
                <th className="num marketsThMaxPos" title="ประมาณ notional USDT สูงสุดจาก tier">
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
                const basisUp = r.basisPct >= 0;
                return (
                  <tr key={r.symbol}>
                    <td data-label="สัญญา" className="marketsCellSymbol">
                      <code>{r.symbol}</code>
                      <div className="sub" style={{ fontSize: "0.75rem", marginTop: "0.15rem", opacity: 0.85 }}>
                        spot: {r.spotSymbol}
                      </div>
                    </td>
                    <td className="num" data-label="Spot">
                      {formatPrice(r.spotPrice)}
                    </td>
                    <td className="num" data-label="Perp">
                      {formatPrice(r.futPrice)}
                    </td>
                    <td
                      className={`num ${basisUp ? "changeUp" : "changeDown"}`}
                      data-label="Basis %"
                    >
                      {basisUp ? "+" : ""}
                      {r.basisPct.toFixed(3)}%
                    </td>
                    <td className={`num ${up ? "changeUp" : "changeDown"}`} data-label="24h">
                      {up ? "+" : ""}
                      {r.change24hPercent.toFixed(2)}%
                    </td>
                    <td className="num" data-label="Vol 24h">
                      {formatUsd(r.amount24Usdt)}
                    </td>
                    <td className="num" data-label="Funding">
                      <span className={`marketsFundingRateBlock marketsFundingRate--${fundingCls}`}>
                        <span className="marketsMetricIcon" aria-hidden>
                          💹
                        </span>
                        <span className="marketsFundingRateText">{formatFunding(r.fundingRate)}</span>
                      </span>
                    </td>
                    <td
                      className={`num marketsCellMaxPos${maxLowLiquidity ? " marketsCellMaxPos--warn" : ""}`}
                      data-label="Max pos"
                      title={
                        maxLowLiquidity
                          ? "ขนาดไม้สูงสุดต่ำเมื่อเทียบกับคู่อื่นในตาราง"
                          : r.maxPositionUsdt != null
                            ? "≈ สัญญา × ราคา (USDT-M)"
                            : undefined
                      }
                    >
                      <span className="marketsMetricIcon" aria-hidden>
                        {maxLowLiquidity ? "⚠️" : "📦"}
                      </span>{" "}
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
