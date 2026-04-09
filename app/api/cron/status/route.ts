import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadCronStatusBundle } from "@/src/cronStatusStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ดูบันทึก cron (JSON) — hourly + price-sync + legacy
 * curl -sH "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/status
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret) {
      return NextResponse.json(
        {
          error: "ตั้ง CRON_SECRET บน Vercel",
          hint:
            "ใส่ CRON_SECRET ใน Environment Variables ให้ครอบคลุม deployment นี้ (Production / Preview) แล้ว redeploy",
        },
        { status: 503 }
      );
    }
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const bundle = await loadCronStatusBundle();
  return NextResponse.json(bundle);
}
