import type { SnowballStatsQualityTier } from "@/lib/snowballStatsClient";

export type SnowballAlertSide = "long" | "bear";

export type ResolveSnowballStatsTradeSideInput = {
  /** ทิศสัญญาณ Snowball ต้นทาง */
  alertSide: SnowballAlertSide;
  qualityTier?: SnowballStatsQualityTier;
  signalOpen: number;
  signalClose: number;
  signalHigh?: number | null;
  signalLow?: number | null;
  signalVolume: number;
  confirmOpen?: number | null;
  confirmClose?: number | null;
  confirmVolume?: number | null;
  /** ผ่าน gate Grade C short fade (1h ในกรอบ 4h) */
  gradeCFadeOk?: boolean;
  /** Long 1H confirm ไม่ผ่าน → short ในสถิติ */
  breakout1hConfirmFail?: boolean;
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * ทิศที่ควรเทรดสำหรับตารางสถิติ (ไม่ใช่ทิศแจ้งเตือน Snowball ตรงๆ)
 * - Bear → short
 * - Long 1H confirm fail → short ก่อนเช็ค confirm>signalHigh
 * - Long + แท่ง confirm แดง (close < open) และ vol สูงกว่าแท่งสัญญาณ → short
 * - Long + confirm ปิดเหนือ signal high → long
 * - Long Grade C → short (fade thesis)
 */
export function resolveSnowballStatsTradeSide(input: ResolveSnowballStatsTradeSideInput): "long" | "short" {
  if (input.alertSide === "bear") return "short";

  if (input.breakout1hConfirmFail || input.qualityTier === "d_plus") return "short";

  const confO = input.confirmOpen;
  const confC = input.confirmClose;
  const confV = input.confirmVolume;
  const hasConfirm = finite(confO) && finite(confC) && finite(confV);

  if (hasConfirm) {
    const confirmRed = confC < confO;
    const sigV = input.signalVolume;
    const confirmHighestVol = sigV > 0 ? confV > sigV : confV > 0;
    if (confirmRed && confirmHighestVol) return "short";

    const sigH = input.signalHigh;
    if (finite(sigH) && confC > sigH) return "long";
  }

  if (input.qualityTier === "c_plus") {
    if (input.gradeCFadeOk) return "short";
    return "short";
  }

  return "long";
}
