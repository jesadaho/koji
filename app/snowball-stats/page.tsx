import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SnowballStatsTelegramMiniApp = dynamic(
  () => import("@/components/SnowballStatsTelegramMiniApp"),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "สถิติ Snowball — Koji",
  description: "บันทึกสัญญาณ Snowball Triple-Check และ follow-up 4h / 12h / 24h",
};

export default function SnowballStatsPage() {
  return <SnowballStatsTelegramMiniApp />;
}
