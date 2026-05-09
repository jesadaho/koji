import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SparkStatsTelegramMiniApp = dynamic(
  () => import("@/components/SparkStatsTelegramMiniApp"),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "สถิติ Spark — Koji",
  description: "Win-rate matrix สำหรับ Spark follow-up (momentum vs fade)",
};

export default function SparkStatsPage() {
  return <SparkStatsTelegramMiniApp />;
}
