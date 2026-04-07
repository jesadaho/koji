import type { Metadata } from "next";
import Link from "next/link";
import {
  getTopUsdtMarkets,
  MIN_AMOUNT24_USDT,
  parseMarketsSort,
  type MarketsSortMode,
} from "@/src/mexcMarkets";

export const revalidate = 60;

const TOP_LIMIT = 50;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { sort?: string };
}): Promise<Metadata> {
  const sort = parseMarketsSort(searchParams?.sort);
  if (sort === "funding") {
    return {
      title: "Markets — Top 50 by |Funding|",
      description:
        "สัญญา USDT perpetual บน MEXC (Vol 24h > 10M USDT) เรียงตาม funding rate ที่ห่างจาก 0 มากที่สุด พร้อม momentum และ max position",
    };
  }
  return {
    title: "Markets — Top 50 MEXC Futures (Momentum)",
    description:
      "สัญญา USDT perpetual บน MEXC (Vol 24h > 10M USDT) เรียงตาม Momentum score (volume spike × price 15m) พร้อม funding และ max position",
  };
}

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

const VOL_FILTER_LABEL = `Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT`;

function sortIntro(sort: MarketsSortMode): string {
  if (sort === "funding") {
    return `Top ${TOP_LIMIT} USDT perpetual เรียงตาม |funding rate| มากสุดก่อน — ${VOL_FILTER_LABEL} · คอลัมน์ Score / Vol× / 15m จาก kline 15m ประกอบ`;
  }
  return `Top ${TOP_LIMIT} USDT perpetual ตาม Momentum score — ${VOL_FILTER_LABEL} · volume แท่ง 15m ล่าสุด เทียบค่าเฉลี่ยย้อนหลัง × % เปลี่ยนราคาในแท่งเดียวกัน`;
}

function footnote(sort: MarketsSortMode): string {
  const base = `${VOL_FILTER_LABEL} · Vol 24h = amount24 · Funding จาก ticker · Max pos (USDT) ≈ สัญญาสูงสุดจาก risk tier × ราคา · Score = (V_recent/V_avg)×(ΔP/P) แท่ง 15m ปิดล่าสุด`;
  if (sort === "funding") {
    return `เรียงตาม |funding| จาก ticker ทุกคู่ที่ผ่านเงื่อนไข · ${base}`;
  }
  return `${base} · ดึง kline จาก candidate ~120 คู่ตาม amount24`;
}

export default async function MarketsPage({ searchParams }: { searchParams: { sort?: string } }) {
  const sort = parseMarketsSort(searchParams?.sort);
  let rows: Awaited<ReturnType<typeof getTopUsdtMarkets>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getTopUsdtMarkets({ sort, limit: TOP_LIMIT });
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  return (
    <main className="marketsPage">
      <h1>Markets</h1>
      <nav className="marketsSortNav" aria-label="เรียงลำดับ">
        <Link href="/markets" aria-current={sort === "momentum" ? "page" : undefined}>
          Momentum
        </Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/markets?sort=funding" aria-current={sort === "funding" ? "page" : undefined}>
          |Funding| สูงสุด
        </Link>
      </nav>
      <p className="sub">{sortIntro(sort)}</p>

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
                  <th className="num" title="ประมาณ notional USDT (สัญญา × ราคา) จาก tier สูงสุด">
                    Max pos (USDT)
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
          <p className="sub marketsFootnote">{footnote(sort)}</p>
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
