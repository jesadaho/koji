import type { Metadata } from "next";
import { MiniAppBacktestNav } from "@/components/MiniAppBacktestNav";
import { MiniAppMainNav } from "@/components/MiniAppMainNav";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";

export const metadata: Metadata = {
  title: "Backtest Snowball — Koji",
  description: "จำลองสัญญาณ Snowball ย้อนหลังจาก klines Binance",
};

export default function SnowballBacktestPage() {
  return (
    <main className="sparkStatsPage">
      <h1 className="sparkStatsMatrixSectionTitle">
        Backtest Snowball
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          จำลองสัญญาณย้อนหลัง · Binance USDT-M
        </span>
      </h1>

      <MiniAppMainNav showHome style={{ marginTop: "0.5rem" }} />

      <MiniAppBacktestNav style={{ marginTop: "0.35rem" }} />

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <p className="sub" style={{ marginTop: 0 }}>
          กำลังพัฒนา — เร็วๆ นี้จะรัน detect Snowball ย้อนหลังและแสดงผลคล้ายสถิติ Live
        </p>
        <p className="sub" style={{ marginBottom: "0.35rem" }}>
          ดูสัญญาณจริงที่ส่งแล้ว:
        </p>
        <MiniAppStatsNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>
    </main>
  );
}
