import type { Metadata } from "next";
import dynamic from "next/dynamic";

const ReversalStatsTelegramMiniApp = dynamic(
  () => import("@/components/ReversalStatsTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "สถิติ Reversal — Koji",
  description:
    "บันทึกสัญญาณ Reversal 1D/1H · follow-up 1H แบบ Snowball (4h/12h/24h/48h) · 1D (1d/3d/7d)",
};

export default function ReversalStatsPage() {
  return <ReversalStatsTelegramMiniApp />;
}
