import type { Metadata } from "next";
import dynamic from "next/dynamic";

const ReversalStatsTelegramMiniApp = dynamic(
  () => import("@/components/ReversalStatsTelegramMiniApp"),
  { ssr: false },
);

export const metadata: Metadata = {
  title: "สถิติ Reversal 1D — Koji",
  description: "บันทึกสัญญาณกลับตัวจากแท่งเทียน Day (โดจิกลับหัว / แท่งแดงทุบ)",
};

export default function ReversalStatsPage() {
  return <ReversalStatsTelegramMiniApp />;
}
