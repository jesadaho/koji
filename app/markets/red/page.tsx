import type { Metadata } from "next";
import Link from "next/link";
import MarketsTableWithSearch from "@/components/MarketsTableWithSearch";
import {
  clampGreenDailyMinDays,
  getUsdtPerpsRedDailyCloses,
  KLINE_CANDIDATE_CAP,
  MIN_AMOUNT24_USDT,
} from "@/src/mexcMarkets";

export const revalidate = 60;

const VOL_FILTER_LABEL = `Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT`;
const SCAN_CAP_LABEL = `สแกน ${KLINE_CANDIDATE_CAP} สัญญาที่มี amount24 สูงสุดก่อน (เหมือน candidate ของ Momentum)`;

function parseWinnersExactFlag(sp: { exact?: string } | undefined): boolean {
  const raw = sp?.exact?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "only";
}

function parseMarketsDebugFlag(sp: { debug?: string } | undefined): boolean {
  const d = sp?.debug?.trim().toLowerCase();
  if (d === "1" || d === "true" || d === "yes") return true;
  const env = process.env.MARKETS_DEBUG_COLUMNS?.trim().toLowerCase();
  return env === "1" || env === "true";
}

function parseMinDays(sp: { days?: string } | undefined): number {
  const raw = sp?.days?.trim();
  if (!raw) return 3;
  return clampGreenDailyMinDays(Number(raw));
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

function marketsRedHref(debug: boolean, minDays: number, exact: boolean): string {
  const p = new URLSearchParams();
  if (debug) p.set("debug", "1");
  if (minDays !== 3) p.set("days", String(minDays));
  if (exact) p.set("exact", "1");
  const q = p.toString();
  return q ? `/markets/red?${q}` : "/markets/red";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { debug?: string; days?: string; exact?: string };
}): Promise<Metadata> {
  const minDays = parseMinDays(searchParams);
  const exact = parseWinnersExactFlag(searchParams);
  return {
    title: `Markets — Day1 แดงติด${exact ? "เท่ากับ" : "อย่างน้อย"} ${minDays} วัน`,
    description: `USDT perpetual บน MEXC — แท่งรายวันปิดแล้ว${exact ? "เท่ากับ" : "อย่างน้อย"} ${minDays} วันล่าสุดแดงทุกแท่ง (close < open) — แสดงสตรีคแดงติดจริง — ${VOL_FILTER_LABEL} — ${SCAN_CAP_LABEL}`,
  };
}

export default async function MarketsRedPage({
  searchParams,
}: {
  searchParams: { debug?: string; days?: string; exact?: string };
}) {
  const showDebugColumns = parseMarketsDebugFlag(searchParams);
  const minDays = parseMinDays(searchParams);
  const exact = parseWinnersExactFlag(searchParams);
  let rows: Awaited<ReturnType<typeof getUsdtPerpsRedDailyCloses>> = [];
  let errorMessage: string | null = null;

  try {
    rows = await getUsdtPerpsRedDailyCloses({ minDays });
    if (exact) {
      rows = rows.filter((r) => r.redDayStreak === minDays);
    }
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  const empty = !errorMessage && rows.length === 0;

  return (
    <main className="marketsPage">
      <h1>Day1 แดงติด ({exact ? "เฉพาะ" : "อย่างน้อย"} {minDays} วัน)</h1>
      <nav className="marketsSortNav" aria-label="เพจ Markets">
        <Link href={marketsMainHref("momentum", showDebugColumns)}>Momentum</Link>
        <Link href={marketsMainHref("funding", showDebugColumns)}>|Funding| สูงสุด</Link>
        <Link href={marketsMainHref("basis", showDebugColumns)}>Spot–Perp basis</Link>
        <Link href={marketsLosersHref(showDebugColumns)}>Top loser (24h) by vol</Link>
        <Link href={marketsWinnersHref(showDebugColumns)}>Day1 เขียวติด</Link>
        <Link href={marketsRedHref(showDebugColumns, minDays, exact)} aria-current="page">
          Day1 แดงติด
        </Link>
      </nav>
      <p className="sub" role="navigation" aria-label="เลือกเกณฑ์ขั้นต่ำ">
        <span className="marketsGreenDaysLabel">เกณฑ์ขั้นต่ำ (แท่งปิดล่าสุด): </span>
        {([2, 3, 4, 5] as const).map((d, i) => (
          <span key={d}>
            {i > 0 ? " · " : null}
            <Link
              href={marketsRedHref(showDebugColumns, d, exact)}
              aria-current={d === minDays ? "page" : undefined}
            >
              {d} วัน
            </Link>
          </span>
        ))}
      </p>
      <p className="sub" role="navigation" aria-label="ตัวกรองจำนวนวัน">
        <span className="marketsGreenDaysLabel">แสดงผล: </span>
        <Link href={marketsRedHref(showDebugColumns, minDays, false)} aria-current={!exact ? "page" : undefined}>
          อย่างน้อย {minDays} วัน
        </Link>
        {" · "}
        <Link href={marketsRedHref(showDebugColumns, minDays, true)} aria-current={exact ? "page" : undefined}>
          เฉพาะ {minDays} วัน
        </Link>
      </p>
      <p className="sub">
        สัญญาที่ <strong>แท่งรายวัน (Day1) ปิดแล้ว{exact ? "เท่ากับ" : "อย่างน้อย"} {minDays} วันล่าสุด</strong>เป็นแท่งแดงครบทุกวัน (
        <strong>{`close < open`}</strong> ต่อแท่ง) — คอลัมน์ <strong>แดงติด</strong> คือจำนวนวันที่แดงติดจริงย้อนจากล่าสุด — เรียงตาม{" "}
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
            ไม่มีสัญญาในชุดที่สแกนที่ตรงเงื่อนไขอย่างน้อย {minDays} วันแดงติด (หรือไม่มีข้อมูล Day1)
          </p>
        </div>
      ) : (
        <div className="card marketsCard">
          <MarketsTableWithSearch
            rows={rows}
            showDebugColumns={showDebugColumns}
            marketsSort="momentum"
            showDayStreakColumn="red"
          />
          <p className="sub marketsFootnote">
            {VOL_FILTER_LABEL} · kline Day1 จาก MEXC contract/kline · %24h จาก ticker — {SCAN_CAP_LABEL}
          </p>
        </div>
      )}

      <p className="sub tmaQuickNav" style={{ marginTop: "1rem" }}>
        <Link href={marketsMainHref("momentum", showDebugColumns)}>← Markets หลัก (Momentum / Funding / Basis)</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/">หน้าแจ้งเตือน</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/settings">Settings</Link>
      </p>
    </main>
  );
}

