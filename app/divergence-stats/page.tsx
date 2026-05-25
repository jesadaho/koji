import type { Metadata } from "next";
import dynamic from "next/dynamic";

const DivergenceStatsTelegramMiniApp = dynamic(
  () => import("@/components/DivergenceStatsTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "สถิติ RSI Divergence — Koji",
  description:
    "บันทึกสัญญาณ RSI Bullish/Bearish Divergence · follow-up 1d/3d/7d · ผลที่ 7d · vol 24h + mcap ณ แจ้ง",
};

export default function DivergenceStatsPage() {
  return <DivergenceStatsTelegramMiniApp />;
}
