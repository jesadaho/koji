import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SettingsTelegramMiniApp = dynamic(
  () => import("@/components/SettingsTelegramMiniApp"),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "Settings — Koji",
  description: "Koji — Telegram Mini App",
};

export default function SettingsPage() {
  return <SettingsTelegramMiniApp />;
}
