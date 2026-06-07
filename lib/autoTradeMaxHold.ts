/** ใช้ maxHold จาก Settings สด (ถ้า TP เปิด) — fallback snapshot ตอนเปิด */
export function resolveAutoTradeMaxHoldHours(input: {
  activeMaxHoldHours?: number | null;
  liveMaxHoldHours?: number | null;
  tpSlEnabled?: boolean;
  defaultHours?: number;
}): number {
  const fallback = input.defaultHours ?? 48;
  if (input.tpSlEnabled) {
    if (
      typeof input.liveMaxHoldHours === "number" &&
      Number.isFinite(input.liveMaxHoldHours) &&
      input.liveMaxHoldHours > 0
    ) {
      return input.liveMaxHoldHours;
    }
  }
  if (
    typeof input.activeMaxHoldHours === "number" &&
    Number.isFinite(input.activeMaxHoldHours) &&
    input.activeMaxHoldHours > 0
  ) {
    return input.activeMaxHoldHours;
  }
  if (
    typeof input.liveMaxHoldHours === "number" &&
    Number.isFinite(input.liveMaxHoldHours) &&
    input.liveMaxHoldHours > 0
  ) {
    return input.liveMaxHoldHours;
  }
  return fallback;
}

export function resolveAutoTradeHoldExtendIfRed(input: {
  activeHoldExtendIfRed?: boolean | null;
  liveHoldExtendIfRed?: boolean | null;
  tpSlEnabled?: boolean;
}): boolean {
  if (input.tpSlEnabled && input.liveHoldExtendIfRed === true) return true;
  if (input.activeHoldExtendIfRed === true) return true;
  if (input.liveHoldExtendIfRed === true) return true;
  return false;
}

export function autoTradePhase1HoldMs(phase1Hours: number): number {
  return Math.max(0, phase1Hours) * 3600 * 1000;
}

export function autoTradePhase2HoldMs(phase1Hours: number): number {
  return autoTradePhase1HoldMs(phase1Hours) * 2;
}

/** @deprecated ใช้ resolveAutoTradeHoldCheckpoint */
export function autoTradeMaxHoldDue(
  openedAtMs: number,
  maxHoldHours: number,
  nowMs = Date.now(),
): boolean {
  if (!(openedAtMs > 0) || !(maxHoldHours > 0)) return false;
  return nowMs - openedAtMs >= maxHoldHours * 3600 * 1000;
}

export type AutoTradeHoldCheckpoint =
  | { action: "continue" }
  | { action: "extend_red"; phase1Hours: number }
  | { action: "force_close"; holdHours: number; phase: 1 | 2 };

/**
 * จังหวะ 1 = phase1Hours · option เปิด + ปิดแดง → ขยายอีก phase1Hours (รวม 2×)
 * markPnlPct = pricePctDrop (ติดลบ = ขาดทุนถ้าปิดตอนนี้)
 */
export function resolveAutoTradeHoldCheckpoint(input: {
  openedAtMs: number;
  phase1Hours: number;
  extendIfRedEnabled?: boolean;
  holdExtendedForRed?: boolean;
  markPnlPct: number;
  nowMs?: number;
}): AutoTradeHoldCheckpoint {
  const now = input.nowMs ?? Date.now();
  const p1 = input.phase1Hours > 0 ? input.phase1Hours : 48;
  const p1Ms = autoTradePhase1HoldMs(p1);
  const p2Ms = autoTradePhase2HoldMs(p1);
  const age = now - input.openedAtMs;
  if (!(input.openedAtMs > 0) || age < 0) return { action: "continue" };

  if (input.extendIfRedEnabled) {
    if (age >= p2Ms) {
      return { action: "force_close", holdHours: p1 * 2, phase: 2 };
    }
    if (age >= p1Ms) {
      if (input.holdExtendedForRed) {
        return { action: "continue" };
      }
      if (input.markPnlPct < 0) {
        return { action: "extend_red", phase1Hours: p1 };
      }
      return { action: "force_close", holdHours: p1, phase: 1 };
    }
    return { action: "continue" };
  }

  if (age >= p1Ms) {
    return { action: "force_close", holdHours: p1, phase: 1 };
  }
  return { action: "continue" };
}
