import { redirect } from "next/navigation";

/** @deprecated ใช้ /trade/bot-trade */
export default function AutoOpenHistoryRedirectPage() {
  redirect("/trade/bot-trade");
}
