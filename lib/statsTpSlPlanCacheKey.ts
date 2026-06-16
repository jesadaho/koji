import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
} from "@/lib/tpSlBreakevenPlan";
import type { StatsTpSlPlan } from "@/lib/tpSlStrategySimulate";

export function statsTpSlPlanCacheKey(plan: StatsTpSlPlan, holdHorizonHours?: number): string {
  const slArm = plan.slAtEntryArmRoiPct ?? DEFAULT_SL_ARM_ROI_PCT;
  const slOff = plan.slAtEntryOffsetPct ?? DEFAULT_SL_ENTRY_OFFSET_PCT;
  const ext = plan.holdExtendIfRedEnabled ? (plan.holdExtendRedHours ?? plan.maxHoldHours) : 0;
  const horizon = holdHorizonHours ?? 0;
  return `${plan.tp1PricePct}-${plan.tp1PartialPct}-${plan.tp2PricePct}-${plan.maxHoldHours}-${ext}-${plan.holdExtendIfRedEnabled ? 1 : 0}-${horizon}-${slArm}-${slOff}`;
}
