import type { Metadata } from "next";
import Link from "next/link";
import MarketsSpotFutTable from "@/components/MarketsSpotFutTable";
import MarketsTableWithSearch from "@/components/MarketsTableWithSearch";
import {
  getTopUsdtMarkets,
  getTopUsdtMarketsBySpotFutBasis,
  MIN_AMOUNT24_USDT,
  parseMarketsSort,
  type MarketsSortMode,
} from "@/src/mexcMarkets";

export const revalidate = 60;

const TOP_LIMIT = 50;
const BASIS_TOP_LIMIT = 10;

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
  if (sort === "basis") {
    return {
      title: "Markets — Top 10 Spot vs Perp basis",
      description:
        `สัญญา USDT perpetual บน MEXC (Vol 24h > ${MIN_AMOUNT24_USDT / 1e6}M USDT) เรียงตามความต่าง % ระหว่างราคา perp กับ spot — ข้อมูล snapshot ไม่ได้พิสูจน์พฤติกรรมตลาด`,
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

function marketsRedHref(debug: boolean): string {
  return debug ? "/markets/red?debug=1" : "/markets/red";
}

function sortIntro(sort: MarketsSortMode, showDebugColumns: boolean): string {
  if (sort === "basis") {
    return `Top ${BASIS_TOP_LIMIT} USDT perpetual เรียงตาม |basis| มากสุดก่อน — basis = (ราคา perp − ราคา spot) / spot × 100 — ${VOL_FILTER_LABEL} · คู่ที่ไม่มี spot บน MEXC จะไม่แสดง`;
  }
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
  if (sort === "basis") {
    return [
      `${VOL_FILTER_LABEL} · ราคา spot จาก MEXC Spot API (v3/ticker/price) · ราคา perp จาก contract/ticker`,
      "คอลัมน์ Δ Basis 24h / ช่วง 24h คำนวณจากแท่ง 1h (spot + perp kline) ที่จับคู่เวลา — ไม่ใช่ราคาเรียลไทม์",
      "Basis ปัจจุบันเป็นค่าประมาณณ จุดหนึ่ง — ไม่ได้พิสูจน์การไล่ liquidate หรือเจตนาเจ้าตลาด; ใช้เป็นมุมมองข้อมูลเท่านั้น",
    ].join(" · ");
  }
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
  let rowsMomentum: Awaited<ReturnType<typeof getTopUsdtMarkets>> = [];
  let rowsBasis: Awaited<ReturnType<typeof getTopUsdtMarketsBySpotFutBasis>> = [];
  let errorMessage: string | null = null;

  try {
    if (sort === "basis") {
      rowsBasis = await getTopUsdtMarketsBySpotFutBasis({ limit: BASIS_TOP_LIMIT });
    } else {
      rowsMomentum = await getTopUsdtMarkets({ sort, limit: TOP_LIMIT });
    }
  } catch {
    errorMessage = "โหลดข้อมูลจาก MEXC ไม่ได้ ลองใหม่ภายหลัง";
  }

  const emptyBasis = sort === "basis" && !errorMessage && rowsBasis.length === 0;
  const emptyMomentum =
    sort !== "basis" && !errorMessage && rowsMomentum.length === 0;

  return (
    <main className="marketsPage">
      <h1>Markets</h1>
      <nav className="marketsSortNav" aria-label="เรียงลำดับ">
        <Link href={marketsHref("momentum", showDebugColumns)} aria-current={sort === "momentum" ? "page" : undefined}>
          Momentum
        </Link>
        <Link href={marketsHref("funding", showDebugColumns)} aria-current={sort === "funding" ? "page" : undefined}>
          |Funding| สูงสุด
        </Link>
        <Link href={marketsHref("basis", showDebugColumns)} aria-current={sort === "basis" ? "page" : undefined}>
          Spot–Perp basis
        </Link>
        <Link href={marketsLosersHref(showDebugColumns)}>Top loser (24h) by vol</Link>
        <Link href={marketsWinnersHref(showDebugColumns)}>Day1 เขียวติด</Link>
        <Link href={marketsRedHref(showDebugColumns)}>Day1 แดงติด</Link>
      </nav>
      <p className="sub">{sortIntro(sort, showDebugColumns)}</p>
      {!errorMessage && sort !== "basis" ? (
        <p className="sub marketsMetricLegend">
          💹 <strong>Funding</strong> + 🕒 <strong>Cycle</strong> ในคอลัมน์เดียว (สี rate = ต้นทุนถือสถานะ · รอบจ่าย) · 📦{" "}
          <strong>Max pos</strong> ขีดจำกัดโน้ต (สีฟ้า) —{" "}
          <span className="marketsLegendWarn">⚠️ ส้ม</span> เมื่อสภาพคล่องต่ำเมื่อเทียบคู่อื่นในตาราง
        </p>
      ) : null}
      {!errorMessage && sort === "basis" ? (
        <p className="sub marketsMetricLegend">
          บวก = ราคา perp สูงกว่า spot (premium) · ลบ = perp ต่ำกว่า spot (discount) · Δ Basis 24h / ช่วง 24h จากแท่ง 1h — ไม่มีคอลัมน์รอบ funding ในโหมดนี้
        </p>
      ) : null}

      {errorMessage ? (
        <div className="card">
          <p className="err" style={{ marginTop: 0 }}>
            {errorMessage}
          </p>
        </div>
      ) : emptyBasis ? (
        <div className="card">
          <p className="sub" style={{ marginBottom: 0 }}>
            ไม่มีคู่ที่จับราคา spot ได้ (หรือไม่มีสัญญาที่ผ่านเงื่อนไขพร้อมคู่ spot บน MEXC)
          </p>
        </div>
      ) : emptyMomentum ? (
        <div className="card">
          <p className="sub" style={{ marginBottom: 0 }}>
            ไม่มีข้อมูลตลาด (หรือคำนวณ momentum ไม่ได้)
          </p>
        </div>
      ) : sort === "basis" ? (
        <div className="card marketsCard">
          <MarketsSpotFutTable rows={rowsBasis} />
          <p className="sub marketsFootnote">{footnote(sort, showDebugColumns)}</p>
        </div>
      ) : (
        <div className="card marketsCard">
          <MarketsTableWithSearch rows={rowsMomentum} showDebugColumns={showDebugColumns} marketsSort={sort} />
          <p className="sub marketsFootnote">{footnote(sort, showDebugColumns)}</p>
        </div>
      )}

      <p className="sub tmaQuickNav" style={{ marginTop: "1rem" }}>
        <Link href="/">← หน้าแจ้งเตือน</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/snowball-stats">สถิติ Snowball</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/reversal-stats">สถิติ Reversal</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/settings">Settings</Link>
      </p>
    </main>
  );
}
