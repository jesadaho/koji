import type { Metadata } from "next";
import Link from "next/link";
import { MiniAppMainNav } from "@/components/MiniAppMainNav";
import { MiniAppTradeNav } from "@/components/MiniAppTradeNav";

export const metadata: Metadata = {
  title: "Trade — Koji",
  description: "ประวัติ Bot Trade — สิ่งที่ Koji สั่งบน MEXC",
};

export default function TradePage() {
  return (
    <main className="sparkStatsPage">
      <MiniAppMainNav showHome style={{ marginTop: 0 }} />

      <h1 className="sparkStatsMatrixSectionTitle" style={{ marginTop: "0.75rem" }}>
        Trade
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          สิ่งที่ Koji สั่งบน MEXC
        </span>
      </h1>

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>ประวัติ Bot Trade</h2>
        <p className="sub" style={{ marginTop: "0.25rem", marginBottom: "0.65rem" }}>
          Snowball + Reversal auto-open · บันทึกทุกครั้งที่ระบบพยายามสั่ง MEXC
        </p>
        <MiniAppTradeNav className="tmaQuickNav" style={{ margin: 0 }} />
      </div>

      <p className="sub" style={{ marginTop: "1rem" }}>
        <Link href="/">กลับหน้าแรก</Link>
        <span className="siteNavSep" aria-hidden>
          {" "}
          |{" "}
        </span>
        <Link href="/stats">Stats</Link>
        <span className="siteNavSep" aria-hidden>
          {" "}
          |{" "}
        </span>
        <Link href="/settings">Settings</Link>
      </p>
    </main>
  );
}
