import type { Metadata } from "next";
import Link from "next/link";
import MarketsTableWithSearch from "@/components/MarketsTableWithSearch";
import {
  getTopUsdtMarketsLoserByVolume,
  TOP_LOSER_24H_PCT_MAX,
  TOP_LOSER_24H_PCT_MIN,
  TOP_LOSER_MIN_AMOUNT24_USDT,
} from "@/src/mexcMarkets";

export const revalidate = 60;

const TOP_LIMIT = 50;

const VOL_FILTER_LABEL = `Vol 24h > ${TOP_LOSER_MIN_AMOUNT24_USDT / 1e6}M USDT`;
const PCT_RANGE_HUMAN = `${Math.abs(TOP_LOSER_24H_PCT_MAX)}% ถึง ${Math.abs(TOP_LOSER_24H_PCT_MIN)}%`;

function parseMarketsDebugFlag(sp: { debug?: string } | undefined): boolean {
  const d = sp?.debug?.trim().toLowerCase();
  if (d === "1" || d === "true" || d === "yes") return true;
  const env = process.env.MARKETS_DEBUG_COLUMNS?.trim().toLowerCase();
  return env === "1" || env === "true";
}

function marketsMainHref(sort: "momentum" | "funding" | "basis", debug: boolean): string {
  const p = new URLSearchParams();
  if (sort === "funding") p.set("sort", "funding");
  if (sort === "basis") p.set("sort", "basis");
  if (debug) p.set("debug", "1");
  const q = p.toString();
  return q ? `/markets?${q}` : "/markets";
}

function marketsWinnersHref(debug: boolean): string {
  return debug ? "/markets/winners?debug=1" : "/markets/winners";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Markets — Top loser by vol (24h -1% … -15%)",
    description: `USDT perpetual บน MEXC — 24h ติดลบ ${PCT_RANGE_HUMAN} — เรียง Vol 24h สูงสุดก่อน — ${VOL_FILTER_LABEL}`,
  };
}

export default async function MarketsLosersPage({
  searchParams,
}: {
  searchParams: { debug?: string };
}) {
  const showDebugColumns = parseMarketsDebugFlag(searchParams);
  let rows: Awaited<ReturnType<typeof getTopUsdtMarketsLoserByVolume>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getTopUsdtMarketsLoserByVolume({ limit: TOP_LIMIT });
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  const empty = !errorMessage && rows.length === 0;

  return (
    <main className="marketsPage">
      <h1>Top loser by vol (24h)</h1>
      <nav className="marketsSortNav" aria-label="เพจ Markets">
        <Link href={marketsMainHref("momentum", showDebugColumns)}>Momentum</Link>
        <Link href={marketsMainHref("funding", showDebugColumns)}>|Funding| สูงสุด</Link>
        <Link href={marketsMainHref("basis", showDebugColumns)}>Spot–Perp basis</Link>
        <Link href={showDebugColumns ? "/markets/losers?debug=1" : "/markets/losers"} aria-current="page">
          Top loser (24h) by vol
        </Link>
        <Link href={marketsWinnersHref(showDebugColumns)}>Day1 เขียวติด</Link>
      </nav>
      <p className="sub">
        สัญญาที่ราคา 24h <strong>ติดลบ {PCT_RANGE_HUMAN}</strong> เรียงตาม <strong>Vol 24h (amount24)</strong> มากสุดก่อน
        — {VOL_FILTER_LABEL}
      </p>
      <p className="sub marketsMetricLegend">
        ไม่รวม 24h ลงน้อยกว่า 1% ลงมากกว่า 15% หรือราคาขึ้น · คอลัมน์ Score / Vol× / 15m ในหน้านี้เป็นค่า placeholder — ดู{" "}
        <Link href={marketsMainHref("momentum", showDebugColumns)}>หน้า Momentum</Link> สำหรับ score จริง
      </p>

      {errorMessage ? (
        <div className="card">
          <p className="err" style={{ marginTop: 0 }}>
            {errorMessage}
          </p>
        </div>
      ) : empty ? (
        <div className="card">
          <p className="sub" style={{ marginBottom: 0 }}>
            ไม่มีสัญญาในช่วง 24h นี้ที่ตรงเงื่อนไข (ลง 1%–15% + Vol มากกว่าเกณฑ์)
          </p>
        </div>
      ) : (
        <div className="card marketsCard">
          <MarketsTableWithSearch rows={rows} showDebugColumns={showDebugColumns} marketsSort="momentum" />
          <p className="sub marketsFootnote">
            {VOL_FILTER_LABEL} · %24h ตาม MEXC API (riseFallRates.r / riseFallRate) — ถ้าไม่ตรงกับเว็บ: ลอง{" "}
            <code>MEXC_24H_FUTURES_CHANGE_TZ_INDEX=0</code> หรือ <code>1</code> / <code>2</code> ให้ตรง 24h timezone
            บน mexc.com
          </p>
        </div>
      )}

      <p className="sub liffQuickNav" style={{ marginTop: "1rem" }}>
        <Link href={marketsMainHref("momentum", showDebugColumns)}>← Markets หลัก (Momentum / Funding / Basis)</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/">หน้าแจ้งเตือน</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/spark-stats">สถิติ Spark</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/settings">Settings</Link>
      </p>
    </main>
  );
}
