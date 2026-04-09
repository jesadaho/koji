import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Production: ต้องมี CRON_SECRET และ Authorization: Bearer — dev ผ่านได้ */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (!isProd) return null;

  if (!secret) {
    return NextResponse.json(
      {
        error: "ตั้ง CRON_SECRET บน Vercel",
        hint:
          "Project → Settings → Environment Variables: เพิ่ม CRON_SECRET แล้วเลือก Environment ให้ตรง (Production และ/หรือ Preview) จากนั้น redeploy",
      },
      { status: 503 }
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}
