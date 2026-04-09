import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SettingsLiffApp = dynamic(() => import("@/components/SettingsLiffApp"), { ssr: false });

export const metadata: Metadata = {
  title: "Settings — Koji",
  description: "ติดตาม System conditions (MEXC Futures)",
};

export default function SettingsPage() {
  return <SettingsLiffApp />;
}
