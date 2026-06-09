import type { Metadata } from "next";
import Link from "next/link";
import { MiniAppBacktestNav } from "@/components/MiniAppBacktestNav";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";

export const metadata: Metadata = {
  title: "Stats — Koji",
  description: "สถิติสัญญาณ Live และ Backtest — Snowball, Reversal, Divergence",
};

export default function StatsPage() {
  return (
    <main className="sparkStatsPage">
      <h1 className="sparkStatsMatrixSectionTitle">
        Stats
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          สัญญาณ Binance · Live follow-up และจำลองย้อนหลัง
        </span>
      </h1>

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Live</h2>
        <p className="sub" style={{ marginTop: "0.25rem", marginBottom: "0.65rem" }}>
          สถิติสัญญาณจริง · follow-up หลังแจ้งเตือน Telegram สำเร็จ
        </p>
        <MiniAppStatsNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Backtest</h2>
        <p className="sub" style={{ marginTop: "0.25rem", marginBottom: "0.65rem" }}>
          จำลองสัญญาณย้อนหลังจาก klines Binance (ยังไม่เปิดใช้งานเต็มรูปแบบ)
        </p>
        <MiniAppBacktestNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>

      <p className="sub" style={{ marginTop: "1rem" }}>
        <Link href="/">กลับหน้าแรก</Link>
        <span className="siteNavSep" aria-hidden>
          {" "}
          |{" "}
        </span>
        <Link href="/trade">Trade</Link>
      </p>
    </main>
  );
}
