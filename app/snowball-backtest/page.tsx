import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SnowballBacktestTelegramMiniApp = dynamic(
  () => import("@/components/SnowballBacktestTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "Backtest Snowball — Koji",
  description: "จำลองสัญญาณ Snowball ย้อนหลังจาก klines Binance",
};

export default function SnowballBacktestPage() {
  return <SnowballBacktestTelegramMiniApp />;
}
