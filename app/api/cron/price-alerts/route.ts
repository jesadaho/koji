import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { createLineClient } from "@/src/lineHandler";
import { runContractConditionTick } from "@/src/contractConditionTick";
import { runPriceAlertTick } from "@/src/priceAlertTick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron หรือเรียกด้วย GET + Authorization: Bearer CRON_SECRET
 * (ถ้าไม่ตั้ง CRON_SECRET ใน production จะปฏิเสธ)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret) {
      return NextResponse.json({ error: "ตั้ง CRON_SECRET บน Vercel" }, { status: 503 });
    }
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  try {
    const client = createLineClient(config.lineChannelAccessToken);
    await runPriceAlertTick(client);
    try {
      await runContractConditionTick(client);
    } catch (e) {
      console.error("[cron] contract condition tick", e);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
