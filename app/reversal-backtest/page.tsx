import type { Metadata } from "next";
import Link from "next/link";
import { MiniAppBacktestNav } from "@/components/MiniAppBacktestNav";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";

export const metadata: Metadata = {
  title: "Backtest Reversal — Koji",
  description: "จำลองสัญญาณ Reversal ย้อนหลังจาก klines Binance",
};

export default function ReversalBacktestPage() {
  return (
    <main className="sparkStatsPage">
      <h1 className="sparkStatsMatrixSectionTitle">
        Backtest Reversal
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          จำลองสัญญาณย้อนหลัง · Binance USDT-M
        </span>
      </h1>

      <p className="sub tmaQuickNav" style={{ marginTop: "0.5rem" }}>
        <Link href="/">หน้าแรก</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/stats">Stats</Link>
      </p>

      <MiniAppBacktestNav style={{ marginTop: "0.35rem" }} />

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <p className="sub" style={{ marginTop: 0 }}>
          กำลังพัฒนา — เร็วๆ นี้จะรัน detect Reversal ย้อนหลังและแสดงผลคล้ายสถิติ Live
        </p>
        <p className="sub" style={{ marginBottom: "0.35rem" }}>
          ดูสัญญาณจริงที่ส่งแล้ว:
        </p>
        <MiniAppStatsNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>
    </main>
  );
}
