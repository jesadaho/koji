import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SparkStatsLiff = dynamic(() => import("@/components/SparkStatsLiff"), { ssr: false });

export const metadata: Metadata = {
  title: "สถิติ Spark — Koji",
  description: "Win-rate matrix สำหรับ Spark follow-up (momentum vs fade)",
};

export default function SparkStatsPage() {
  return <SparkStatsLiff />;
}
