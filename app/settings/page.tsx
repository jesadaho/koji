import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SettingsLiffApp = dynamic(() => import("@/components/SettingsLiffApp"), { ssr: false });

export const metadata: Metadata = {
  title: "Settings — Koji",
  description: "Koji — Telegram Mini App",
};

export default function SettingsPage() {
  return <SettingsLiffApp />;
}
