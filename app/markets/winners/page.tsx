import type { Metadata } from "next";
import Link from "next/link";
import MarketsTableWithSearch from "@/components/MarketsTableWithSearch";
import {
  getUsdtPerpsThreeGreenDailyCloses,
  KLINE_CANDIDATE_CAP,
  MIN_AMOUNT24_USDT,
} from "@/src/mexcMarkets";

export const revalidate = 60;

const VOL_FILTER_LABEL = `Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT`;
const SCAN_CAP_LABEL = `สแกน ${KLINE_CANDIDATE_CAP} สัญญาที่มี amount24 สูงสุดก่อน (เหมือน candidate ของ Momentum)`;

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

function marketsLosersHref(debug: boolean): string {
  return debug ? "/markets/losers?debug=1" : "/markets/losers";
}

function marketsWinnersHref(debug: boolean): string {
  return debug ? "/markets/winners?debug=1" : "/markets/winners";
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Markets — 3 วันเขียวติด (Day1)",
    description: `USDT perpetual บน MEXC — แท่งรายวันปิดแล้ว 3 วันล่าสุดเขียวทุกแท่ง (close > open) — ${VOL_FILTER_LABEL} — ${SCAN_CAP_LABEL}`,
  };
}

export default async function MarketsWinnersPage({
  searchParams,
}: {
  searchParams: { debug?: string };
}) {
  const showDebugColumns = parseMarketsDebugFlag(searchParams);
  let rows: Awaited<ReturnType<typeof getUsdtPerpsThreeGreenDailyCloses>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getUsdtPerpsThreeGreenDailyCloses();
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  const empty = !errorMessage && rows.length === 0;

  return (
    <main className="marketsPage">
      <h1>3 วันเขียวติด (Day1)</h1>
      <nav className="marketsSortNav" aria-label="เพจ Markets">
        <Link href={marketsMainHref("momentum", showDebugColumns)}>Momentum</Link>
        <Link href={marketsMainHref("funding", showDebugColumns)}>|Funding| สูงสุด</Link>
        <Link href={marketsMainHref("basis", showDebugColumns)}>Spot–Perp basis</Link>
        <Link href={marketsLosersHref(showDebugColumns)}>Top loser (24h) by vol</Link>
        <Link href={marketsWinnersHref(showDebugColumns)} aria-current="page">
          3 วันเขียวติด (Day1)
        </Link>
      </nav>
      <p className="sub">
        สัญญาที่ <strong>แท่งรายวัน (Day1) ปิดแล้ว 3 วันล่าสุด</strong>เป็นแท่งเขียวครบทุกวัน (<strong>{`close > open`}</strong> ต่อแท่ง) — เรียงตาม{" "}
        <strong>Vol 24h (amount24)</strong> มากสุดก่อน — {VOL_FILTER_LABEL}
      </p>
      <p className="sub marketsMetricLegend">
        {SCAN_CAP_LABEL} · แท่งสุดท้ายของชุดดิบที่อาจยังไม่ปิดจะถูกตัดออกก่อนตรวจ — คอลัมน์ Score / Vol× / 15m เป็นค่า placeholder — ดู{" "}
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
            ไม่มีสัญญาในชุดที่สแกนที่ตรงเงื่อนไข 3 วันเขียวติด (หรือไม่มีข้อมูล Day1)
          </p>
        </div>
      ) : (
        <div className="card marketsCard">
          <MarketsTableWithSearch rows={rows} showDebugColumns={showDebugColumns} marketsSort="momentum" />
          <p className="sub marketsFootnote">
            {VOL_FILTER_LABEL} · kline Day1 จาก MEXC contract/kline · %24h จาก ticker — {SCAN_CAP_LABEL}
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
