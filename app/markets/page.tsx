import type { Metadata } from "next";
import Link from "next/link";
import MarketsTableWithSearch from "@/components/MarketsTableWithSearch";
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
  searchParams: { sort?: string; debug?: string };
}): Promise<Metadata> {
  const sort = parseMarketsSort(searchParams?.sort);
  if (sort === "funding") {
    return {
      title: "Markets — Top 50 by |Funding|",
      description:
        `สัญญา USDT perpetual บน MEXC (Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT) เรียงตาม funding rate ที่ห่างจาก 0 มากที่สุด พร้อม momentum และ max position`,
    };
  }
  return {
    title: "Markets — Top 50 MEXC Futures (Momentum)",
    description:
      `สัญญา USDT perpetual บน MEXC (Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT) เรียงตาม Momentum score (volume spike × price 15m) พร้อม funding และ max position`,
  };
}

const VOL_FILTER_LABEL = `Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT`;

/** คอลัมน์ Score / Vol× / 15m — เปิดด้วย ?debug=1 หรือ MARKETS_DEBUG_COLUMNS=1 */
function parseMarketsDebugFlag(sp: { debug?: string } | undefined): boolean {
  const d = sp?.debug?.trim().toLowerCase();
  if (d === "1" || d === "true" || d === "yes") return true;
  const env = process.env.MARKETS_DEBUG_COLUMNS?.trim().toLowerCase();
  return env === "1" || env === "true";
}

function marketsHref(sort: MarketsSortMode, debug: boolean): string {
  const p = new URLSearchParams();
  if (sort === "funding") p.set("sort", "funding");
  if (debug) p.set("debug", "1");
  const q = p.toString();
  return q ? `/markets?${q}` : "/markets";
}

function sortIntro(sort: MarketsSortMode, showDebugColumns: boolean): string {
  if (sort === "funding") {
    const dbg = showDebugColumns ? " · คอลัมน์ Score / Vol× / 15m (debug)" : "";
    return `Top ${TOP_LIMIT} USDT perpetual เรียงตาม |funding rate| มากสุดก่อน — ${VOL_FILTER_LABEL}${dbg}`;
  }
  if (showDebugColumns) {
    return `Top ${TOP_LIMIT} USDT perpetual ตาม Momentum score — ${VOL_FILTER_LABEL} · volume แท่ง 15m ล่าสุด เทียบค่าเฉลี่ยย้อนหลัง × % เปลี่ยนราคาในแท่งเดียวกัน`;
  }
  return `Top ${TOP_LIMIT} USDT perpetual ตาม Momentum score — ${VOL_FILTER_LABEL} (คอลัมน์ Score·Vol×·15m ซ่อน — ใส่ ?debug=1 เพื่อดู)`;
}

function footnote(sort: MarketsSortMode, showDebugColumns: boolean): string {
  const core = `${VOL_FILTER_LABEL} · Vol 24h = amount24 · Funding จาก ticker · รอบ/เวลาตัด funding จาก contract/funding_rate · Max pos (USDT) ≈ สัญญาสูงสุดจาก risk tier × ราคา`;
  const momDbg =
    showDebugColumns
      ? ` · Score = (V_recent/V_avg)×(ΔP/P) แท่ง 15m ปิดล่าสุด · ดึง kline จาก candidate ตาม amount24`
      : ` · เรียง momentum ใช้ kline 15m (รายละเอียดคอลัมน์เมื่อ ?debug=1)`;
  if (sort === "funding") {
    return `เรียงตาม |funding| จาก ticker ทุกคู่ที่ผ่านเงื่อนไข · ${core}${showDebugColumns ? momDbg : ""}`;
  }
  return `${core}${momDbg}`;
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: { sort?: string; debug?: string };
}) {
  const sort = parseMarketsSort(searchParams?.sort);
  const showDebugColumns = parseMarketsDebugFlag(searchParams);
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
        <Link href={marketsHref("momentum", showDebugColumns)} aria-current={sort === "momentum" ? "page" : undefined}>
          Momentum
        </Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href={marketsHref("funding", showDebugColumns)} aria-current={sort === "funding" ? "page" : undefined}>
          |Funding| สูงสุด
        </Link>
      </nav>
      <p className="sub">{sortIntro(sort, showDebugColumns)}</p>
      {!errorMessage ? (
        <p className="sub marketsMetricLegend">
          💹 <strong>Funding</strong> สีตามทิศทางต้นทุนถือสถานะ · 🕒 <strong>Cycle</strong> รอบจ่าย · 📦{" "}
          <strong>Max pos</strong> ขีดจำกัดโน้ต (สีฟ้า) —{" "}
          <span className="marketsLegendWarn">⚠️ ส้ม</span> เมื่อสภาพคล่องต่ำเมื่อเทียบคู่อื่นในตาราง
        </p>
      ) : null}

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
          <MarketsTableWithSearch rows={rows} showDebugColumns={showDebugColumns} marketsSort={sort} />
          <p className="sub marketsFootnote">{footnote(sort, showDebugColumns)}</p>
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
