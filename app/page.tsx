import dynamic from "next/dynamic";

const TelegramMiniApp = dynamic(() => import("@/components/TelegramMiniApp"), { ssr: false });

export default function Page() {
  return <TelegramMiniApp />;
}
