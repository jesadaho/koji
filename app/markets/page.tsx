import type { Metadata } from "next";
import Link from "next/link";
import { getTopUsdtMarketsByAmount24 } from "@/src/mexcMarkets";

export const metadata: Metadata = {
  title: "Markets — Top 25 MEXC Futures",
  description: "สัญญา USDT perpetual บน MEXC เรียงตามปริมาณ 24 ชม. (amount24) พร้อม funding และ max position จาก risk tier",
};

export const revalidate = 60;

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

export default async function MarketsPage() {
  let rows: Awaited<ReturnType<typeof getTopUsdtMarketsByAmount24>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getTopUsdtMarketsByAmount24(25);
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  return (
    <main className="marketsPage">
      <h1>Markets</h1>
      <p className="sub">Top 25 USDT perpetual ตามมูลค่าเทิร์นโอเวอร์ 24 ชม. (amount24)</p>

      {errorMessage ? (
        <div className="card">
          <p className="err" style={{ marginTop: 0 }}>
            {errorMessage}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="sub" style={{ marginBottom: 0 }}>
            ไม่มีข้อมูลตลาด
          </p>
        </div>
      ) : (
        <div className="card marketsCard">
          <div className="marketsTableWrap">
            <table className="marketsTable">
              <thead>
                <tr>
                  <th>สัญญา</th>
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
                  return (
                    <tr key={r.symbol}>
                      <td data-label="สัญญา" className="marketsCellSymbol">
                        <code>{r.symbol}</code>
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
            Vol 24h = amount24 (มูลค่า USDT) · Funding จาก ticker · Max pos = max ของ maxVol ใน risk tiers
          </p>
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
