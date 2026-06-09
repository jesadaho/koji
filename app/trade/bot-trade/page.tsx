import type { Metadata } from "next";
import dynamic from "next/dynamic";

const AutoOpenHistoryTelegramMiniApp = dynamic(
  () => import("@/components/AutoOpenHistoryTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "ประวัติ Bot Trade — Koji",
  description: "บันทึกการสั่งเปิดอัตโนมัติ Snowball และ Reversal บน MEXC",
};

export default function BotTradeHistoryPage() {
  return <AutoOpenHistoryTelegramMiniApp />;
}
