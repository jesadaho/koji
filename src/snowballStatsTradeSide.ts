import type { SnowballStatsQualityTier } from "@/lib/snowballStatsClient";

export type SnowballAlertSide = "long" | "bear";

export type ResolveSnowballStatsTradeSideInput = {
  /** ทิศสัญญาณ Snowball ต้นทาง */
  alertSide: SnowballAlertSide;
  qualityTier?: SnowballStatsQualityTier;
  signalOpen?: number;
  signalClose?: number;
  signalHigh?: number | null;
  signalLow?: number | null;
  signalVolume?: number;
  confirmOpen?: number | null;
  confirmClose?: number | null;
  confirmVolume?: number | null;
  /** @deprecated ไม่ใช้ — สถิติ Long alert วัดผลเป็น long เสมอ */
  gradeCFadeOk?: boolean;
  breakout1hConfirmFail?: boolean;
};

/**
 * ทิศวัดผลสถิติ — Long alert = long เสมอ (ไม่ fade short / Long->Short)
 * Bear (swing_ll) = short
 */
export function resolveSnowballStatsTradeSide(input: ResolveSnowballStatsTradeSideInput): "long" | "short" {
  if (input.alertSide === "bear") return "short";
  return "long";
}
