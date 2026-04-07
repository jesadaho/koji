import dynamic from "next/dynamic";

const LiffApp = dynamic(() => import("@/components/LiffApp"), { ssr: false });

export default function Page() {
  return <LiffApp />;
}
