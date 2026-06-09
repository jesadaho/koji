/** Dynamic margin boost — Snowball LONG ตาม BTC slope + PSAR 4h ของคู่สัญญาณ */

export const SNOWBALL_LONG_DYNAMIC_BOOST_PERFECT_SCALE = 3;
export const SNOWBALL_LONG_DYNAMIC_BOOST_CAUTION_SCALE = 1;
export const SNOWBALL_LONG_DYNAMIC_BOOST_PENALTY_SCALE = 0.5;

/** BTC EMA(12) 4h slope % 7d — ต้องมากกว่าค่านี้สำหรับ Perfect */
export const SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PERFECT_MIN = -2;
/** BTC EMA(12) 4h slope % 7d — ต่ำกว่าค่านี้ → Penalty */
export const SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PENALTY_MAX = -10;

export const SNOWBALL_LONG_DYNAMIC_BOOST_CRITERIA_TH =
  "Perfect (BTC Slope > -2% + SAR เขียวคู่) → Boost x3 · Caution (BTC -2% ถึง -10% / SAR ผสม) → 1x · Penalty (BTC < -10% หรือ SAR แดงคู่) → 0.5x";

export type SnowballLongDynamicBoostTier = "perfect" | "caution" | "penalty";

export type SnowballLongDynamicBoostResult = {
  marginScale: number;
  dynamicApplied: boolean;
  tier: SnowballLongDynamicBoostTier | null;
  btcEma4hSlopePct7d: number | null;
  psar4hTrend: "up" | "down" | null;
};

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function perfectScale(): number {
  const v = envNum("SNOWBALL_LONG_DYNAMIC_BOOST_PERFECT_SCALE", SNOWBALL_LONG_DYNAMIC_BOOST_PERFECT_SCALE);
  return v > 0 ? v : SNOWBALL_LONG_DYNAMIC_BOOST_PERFECT_SCALE;
}

function penaltyScale(): number {
  const v = envNum("SNOWBALL_LONG_DYNAMIC_BOOST_PENALTY_SCALE", SNOWBALL_LONG_DYNAMIC_BOOST_PENALTY_SCALE);
  return v > 0 ? v : SNOWBALL_LONG_DYNAMIC_BOOST_PENALTY_SCALE;
}

function btcSlopePerfectMin(): number {
  return envNum(
    "SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PERFECT_MIN",
    SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PERFECT_MIN,
  );
}

function btcSlopePenaltyMax(): number {
  return envNum(
    "SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PENALTY_MAX",
    SNOWBALL_LONG_DYNAMIC_BOOST_BTC_SLOPE_PENALTY_MAX,
  );
}

export function resolveSnowballLongDynamicBoostMarginScale(input: {
  dynamicBoostEnabled: boolean;
  side: "long" | "short";
  btcEma4hSlopePct7d?: number | null;
  psar4hTrend?: "up" | "down" | null;
}): SnowballLongDynamicBoostResult {
  const btc =
    input.btcEma4hSlopePct7d != null && Number.isFinite(input.btcEma4hSlopePct7d)
      ? input.btcEma4hSlopePct7d
      : null;
  const psar = input.psar4hTrend === "up" || input.psar4hTrend === "down" ? input.psar4hTrend : null;

  if (input.side !== "long" || !input.dynamicBoostEnabled) {
    return { marginScale: 1, dynamicApplied: false, tier: null, btcEma4hSlopePct7d: btc, psar4hTrend: psar };
  }

  const perfectMin = btcSlopePerfectMin();
  const penaltyMax = btcSlopePenaltyMax();

  if (btc != null && btc < penaltyMax) {
    return {
      marginScale: penaltyScale(),
      dynamicApplied: true,
      tier: "penalty",
      btcEma4hSlopePct7d: btc,
      psar4hTrend: psar,
    };
  }
  if (psar === "down") {
    return {
      marginScale: penaltyScale(),
      dynamicApplied: true,
      tier: "penalty",
      btcEma4hSlopePct7d: btc,
      psar4hTrend: psar,
    };
  }
  if (btc != null && btc > perfectMin && psar === "up") {
    return {
      marginScale: perfectScale(),
      dynamicApplied: true,
      tier: "perfect",
      btcEma4hSlopePct7d: btc,
      psar4hTrend: psar,
    };
  }

  return {
    marginScale: SNOWBALL_LONG_DYNAMIC_BOOST_CAUTION_SCALE,
    dynamicApplied: true,
    tier: "caution",
    btcEma4hSlopePct7d: btc,
    psar4hTrend: psar,
  };
}

export function snowballLongDynamicBoostNote(
  result: Pick<SnowballLongDynamicBoostResult, "dynamicApplied" | "tier" | "marginScale" | "btcEma4hSlopePct7d" | "psar4hTrend">,
  marginBase: number,
): string | null {
  if (!result.dynamicApplied || result.tier == null) return null;
  const btc =
    result.btcEma4hSlopePct7d != null ? `${result.btcEma4hSlopePct7d.toFixed(2)}%` : "—";
  const sar =
    result.psar4hTrend === "up" ? "เขียว" : result.psar4hTrend === "down" ? "แดง" : "—";
  const margin = marginBase * result.marginScale;
  if (result.tier === "perfect") {
    return `Dynamic boost: Perfect · BTC Slope ${btc} · SAR ${sar} → margin x${result.marginScale} (~${margin.toFixed(2)} USDT)`;
  }
  if (result.tier === "caution") {
    return `Dynamic boost: Caution · BTC Slope ${btc} · SAR ${sar} → margin x${result.marginScale} (~${margin.toFixed(2)} USDT)`;
  }
  return `Dynamic boost: Penalty · BTC Slope ${btc} · SAR ${sar} → margin x${result.marginScale} (~${margin.toFixed(2)} USDT)`;
}
