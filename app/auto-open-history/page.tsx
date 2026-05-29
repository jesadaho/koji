import type { Metadata } from "next";
import dynamic from "next/dynamic";

const AutoOpenHistoryTelegramMiniApp = dynamic(
  () => import("@/components/AutoOpenHistoryTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "ประวัติ Auto-open — Koji",
  description: "บันทึกการสั่งเปิดอัตโนมัติ Snowball และ Reversal บน MEXC",
};

export default function AutoOpenHistoryPage() {
  return <AutoOpenHistoryTelegramMiniApp />;
}
