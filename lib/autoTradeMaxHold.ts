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

export function autoTradeMaxHoldDue(
  openedAtMs: number,
  maxHoldHours: number,
  nowMs = Date.now(),
): boolean {
  if (!(openedAtMs > 0) || !(maxHoldHours > 0)) return false;
  return nowMs - openedAtMs >= maxHoldHours * 3600 * 1000;
}
