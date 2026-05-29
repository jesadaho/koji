import type { Metadata } from "next";
import Link from "next/link";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";

export const metadata: Metadata = {
  title: "Stats — Koji",
  description: "รวมหน้าสถิติสัญญาณ Snowball, Reversal และ Divergence",
};

export default function StatsPage() {
  return (
    <main className="sparkStatsPage">
      <h1 className="sparkStatsMatrixSectionTitle">
        Stats
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          สถิติสัญญาณ · follow-up หลังแจ้งเตือน Telegram สำเร็จ
        </span>
      </h1>

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>เลือกตารางสถิติ</h2>
        <p className="sub" style={{ marginTop: "0.25rem", marginBottom: "0.65rem" }}>
          Snowball, Reversal, Divergence และประวัติ Auto-open แยกเป็นหน้าของตัวเอง
        </p>
        <MiniAppStatsNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>

      <p className="sub" style={{ marginTop: "1rem" }}>
        <Link href="/">กลับหน้าแรก</Link>
      </p>
    </main>
  );
}
