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

/** ชั่วโมงขยายจังหวะ 2 เมื่อแดง — default = จังหวะ 1 (max hold) */
export function resolveAutoTradeHoldExtendRedHours(input: {
  phase1Hours: number;
  activeHoldExtendRedHours?: number | null;
  liveHoldExtendRedHours?: number | null;
  tpSlEnabled?: boolean;
}): number {
  const p1 = input.phase1Hours > 0 ? input.phase1Hours : 48;
  const pick = (v: number | null | undefined): number | null => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    return null;
  };
  if (input.tpSlEnabled) {
    const live = pick(input.liveHoldExtendRedHours);
    if (live != null) return live;
  }
  const snap = pick(input.activeHoldExtendRedHours);
  if (snap != null) return snap;
  const liveFallback = pick(input.liveHoldExtendRedHours);
  if (liveFallback != null) return liveFallback;
  return p1;
}

export function autoTradePhase1HoldMs(phase1Hours: number): number {
  return Math.max(0, phase1Hours) * 3600 * 1000;
}

/** รวมจังหวะ 1 + ขยายเมื่อแดง (จังหวะ 2) */
export function autoTradeTotalMaxHoldMs(phase1Hours: number, extendRedHours: number): number {
  const p1 = phase1Hours > 0 ? phase1Hours : 48;
  const ext = extendRedHours > 0 ? extendRedHours : p1;
  return autoTradePhase1HoldMs(p1 + ext);
}

/** @deprecated ใช้ autoTradeTotalMaxHoldMs */
export function autoTradePhase2HoldMs(phase1Hours: number): number {
  return autoTradeTotalMaxHoldMs(phase1Hours, phase1Hours);
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
  | { action: "extend_red"; phase1Hours: number; extendRedHours: number }
  | { action: "force_close"; holdHours: number; phase: 1 | 2 };

/**
 * จังหวะ 1 = phase1Hours · option เปิด + ปิดแดง → ขยายอีก extendRedHours (default = phase1)
 * markPnlPct = pricePctDrop (ติดลบ = ขาดทุนถ้าปิดตอนนี้)
 */
export function resolveAutoTradeHoldCheckpoint(input: {
  openedAtMs: number;
  phase1Hours: number;
  extendRedHours?: number;
  extendIfRedEnabled?: boolean;
  holdExtendedForRed?: boolean;
  markPnlPct: number;
  nowMs?: number;
}): AutoTradeHoldCheckpoint {
  const now = input.nowMs ?? Date.now();
  const p1 = input.phase1Hours > 0 ? input.phase1Hours : 48;
  const ext =
    typeof input.extendRedHours === "number" && Number.isFinite(input.extendRedHours) && input.extendRedHours > 0
      ? input.extendRedHours
      : p1;
  const p1Ms = autoTradePhase1HoldMs(p1);
  const totalMs = autoTradeTotalMaxHoldMs(p1, ext);
  const age = now - input.openedAtMs;
  if (!(input.openedAtMs > 0) || age < 0) return { action: "continue" };

  if (input.extendIfRedEnabled) {
    if (age >= totalMs) {
      return { action: "force_close", holdHours: p1 + ext, phase: 2 };
    }
    if (age >= p1Ms) {
      if (input.holdExtendedForRed) {
        return { action: "continue" };
      }
      if (input.markPnlPct < 0) {
        return { action: "extend_red", phase1Hours: p1, extendRedHours: ext };
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

export type AutoOpenMaxHoldSafetyDue = {
  due: true;
  reason: "checkpoint_force_close" | "past_absolute_max" | "orphan_past_phase1";
  holdHours: number;
  phase?: 1 | 2;
};

/** Safety cron — ปิดไม้ live ที่เกิน max hold (orphan / primary tick พลาด) */
export function evaluateAutoOpenMaxHoldSafetyClose(input: {
  openedAtMs: number;
  phase1Hours: number;
  extendRedHours: number;
  extendIfRedEnabled: boolean;
  holdExtendedForRed: boolean;
  inBotState: boolean;
  markPnlPct: number;
  nowMs?: number;
  graceMs?: number;
}): AutoOpenMaxHoldSafetyDue | null {
  const now = input.nowMs ?? Date.now();
  const graceMs = input.graceMs ?? 30 * 60 * 1000;
  const p1 = input.phase1Hours > 0 ? input.phase1Hours : 48;
  const ext =
    typeof input.extendRedHours === "number" && Number.isFinite(input.extendRedHours) && input.extendRedHours > 0
      ? input.extendRedHours
      : p1;
  const p1Ms = autoTradePhase1HoldMs(p1);
  const totalMs = input.extendIfRedEnabled ? autoTradeTotalMaxHoldMs(p1, ext) : p1Ms;
  const age = now - input.openedAtMs;
  if (!(input.openedAtMs > 0) || age < 0) return null;

  const checkpoint = resolveAutoTradeHoldCheckpoint({
    openedAtMs: input.openedAtMs,
    phase1Hours: p1,
    extendRedHours: ext,
    extendIfRedEnabled: input.extendIfRedEnabled,
    holdExtendedForRed: input.holdExtendedForRed,
    markPnlPct: input.markPnlPct,
    nowMs: now,
  });

  if (input.inBotState && checkpoint.action === "force_close") {
    return {
      due: true,
      reason: "checkpoint_force_close",
      holdHours: checkpoint.holdHours,
      phase: checkpoint.phase,
    };
  }

  if (age >= totalMs + graceMs) {
    return {
      due: true,
      reason: "past_absolute_max",
      holdHours: input.extendIfRedEnabled ? p1 + ext : p1,
      phase: input.extendIfRedEnabled ? 2 : 1,
    };
  }

  if (!input.inBotState && age >= p1Ms + graceMs) {
    return {
      due: true,
      reason: "orphan_past_phase1",
      holdHours: p1,
      phase: 1,
    };
  }

  return null;
}
