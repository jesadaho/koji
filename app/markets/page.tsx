import type { Metadata } from "next";
import Link from "next/link";
import { getTopUsdtMarketsByMomentum } from "@/src/mexcMarkets";

export const metadata: Metadata = {
  title: "Markets — Top 50 MEXC Futures (Momentum)",
  description:
    "สัญญา USDT perpetual บน MEXC เรียงตาม Momentum score (volume spike × price 15m) พร้อม funding และ max position",
};

export const revalidate = 60;

const TOP_LIMIT = 50;

function formatUsd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function formatFunding(rate: number): string {
  const pct = rate * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(4)}%`;
}

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

export default async function MarketsPage() {
  let rows: Awaited<ReturnType<typeof getTopUsdtMarketsByMomentum>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getTopUsdtMarketsByMomentum(TOP_LIMIT);
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  return (
    <main className="marketsPage">
      <h1>Markets</h1>
      <p className="sub">
        Top {TOP_LIMIT} USDT perpetual ตาม Momentum score — volume แท่ง 15m ล่าสุด เทียบค่าเฉลี่ยย้อนหลัง × % เปลี่ยนราคาในแท่งเดียวกัน
      </p>

      {errorMessage ? (
        <div className="card">
          <p className="err" style={{ marginTop: 0 }}>
            {errorMessage}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="sub" style={{ marginBottom: 0 }}>
            ไม่มีข้อมูลตลาด (หรือคำนวณ momentum ไม่ได้)
          </p>
        </div>
      ) : (
        <div className="card marketsCard">
          <div className="marketsTableWrap">
            <table className="marketsTable">
              <thead>
                <tr>
                  <th>สัญญา</th>
                  <th className="num" title="(V_recent/V_avg)×(ΔP/P)">
                    Score
                  </th>
                  <th className="num" title="Volume แท่ง 15m ปิดล่าสุด / เฉลี่ยแท่งก่อนหน้า">
                    Vol×
                  </th>
                  <th className="num">15m</th>
                  <th className="num">ราคา</th>
                  <th className="num">24h</th>
                  <th className="num">Vol 24h (USDT)</th>
                  <th className="num">Funding</th>
                  <th className="num" title="สูงสุดจาก risk tier (สัญญา)">
                    Max pos
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const up = r.change24hPercent >= 0;
                  const up15 = r.return15mPercent >= 0;
                  return (
                    <tr key={r.symbol}>
                      <td data-label="สัญญา" className="marketsCellSymbol">
                        <code>{r.symbol}</code>
                      </td>
                      <td className="num" data-label="Score">
                        {formatScore(r.momentumScore)}
                      </td>
                      <td className="num" data-label="Vol×">
                        {r.volumeSpikeRatio.toFixed(2)}×
                      </td>
                      <td className={`num ${up15 ? "changeUp" : "changeDown"}`} data-label="15m">
                        {up15 ? "+" : ""}
                        {r.return15mPercent.toFixed(2)}%
                      </td>
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
                      <td className="num" data-label="Funding">
                        {formatFunding(r.fundingRate)}
                      </td>
                      <td
                        className="num"
                        data-label="Max pos"
                        title="จาก riskLimitCustom tier สูงสุด (หรือ limit ของสัญญา)"
                      >
                        {r.maxPositionContracts != null ? r.maxPositionContracts.toLocaleString("en-US") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sub marketsFootnote">
            Score = (V_recent/V_avg)×(ΔP/P) แท่ง 15m ปิดล่าสุด · ดึง kline จาก candidate ~120 คู่ตาม amount24 · Vol 24h = amount24 ·
            Funding จาก ticker · Max pos จาก risk tiers
          </p>
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
