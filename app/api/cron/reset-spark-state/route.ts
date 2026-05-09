import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/src/cronAuth";
import { resetSparkFollowUpState } from "@/src/sparkFollowUpStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ล้างข้อมูล Spark matrix (state เดียวกับสถิติที่โชว์ใน Mini App) — เรียกด้วยตนเอง ไม่ใส่ใน vercel.json crons
 *
 * GET /api/cron/reset-spark-state — Authorization: Bearer $CRON_SECRET
 *
 * ล้าง: pending follow-up · history (win-rate) · recentSparks (fire log ใน state)
 * ไม่แตะ: price_spike_15m_alert_state / ช่องอื่น
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  await resetSparkFollowUpState();
  return NextResponse.json({
    ok: true,
    cleared: ["pending", "history", "recentSparks"],
    note: "Spark follow-up state reset — เก็บสถิติใหม่ได้ทันทีหลังมี Spark ใหม่",
  });
}
