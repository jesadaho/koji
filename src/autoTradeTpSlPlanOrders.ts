import {
  cancelPlanOrders,
  fetchContractDetailPublic,
  getFuturesUserPositionMode,
  placePlanOrderTakeProfit,
  roundVolDown,
  type MexcCredentials,
  type MexcOk,
  type OpenPositionRow,
  type PlanOrderCreateData,
} from "./mexcFuturesClient";

export type AutoTradePositionSide = "long" | "short";

/** ราคา trigger TP จาก entry + % กำไร (long ขึ้น / short ลง) */
export function favorableTpTriggerPrice(
  side: AutoTradePositionSide,
  entry: number,
  pricePct: number,
): number {
  if (!(entry > 0) || !(pricePct > 0)) return NaN;
  const m = pricePct / 100;
  return side === "long" ? entry * (1 + m) : entry * (1 - m);
}

export function extractPlanOrderId(res: MexcOk<PlanOrderCreateData>): string | undefined {
  if (!res.success || res.data == null) return undefined;
  const d = res.data;
  if (typeof d === "string") {
    const s = d.trim();
    return s || undefined;
  }
  const id = d.orderId;
  if (typeof id === "string") {
    const s = id.trim();
    return s || undefined;
  }
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}

export function fmtAutoTradeTpPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export type PlaceTpPlanOrdersResult = {
  tp1PlanOrderId?: string;
  tp2PlanOrderId?: string;
  initialHoldVol: number;
  tp1TriggerPrice: number;
  tp2TriggerPrice: number;
  tp1Vol: number;
  tp2Vol: number;
  notifyLines: string[];
  warnings: string[];
};

/**
 * วาง plan TP1 (partial) + TP2 (ที่เหลือ) บน MEXC ทันทีหลังมี position
 */
export async function placeTpPlanOrdersAfterOpen(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    position: OpenPositionRow;
    entry: number;
    side: AutoTradePositionSide;
    tp1PricePct: number;
    tp1PartialPct: number;
    tp2PricePct: number;
  },
): Promise<PlaceTpPlanOrdersResult | null> {
  const sym = p.contractSymbol.trim();
  const entry = p.entry;
  const holdVol = p.position.holdVol;
  if (!(entry > 0) || !(holdVol > 0)) return null;

  const detail = await fetchContractDetailPublic(sym);
  if (!detail) return null;

  let positionMode: 1 | 2 = 1;
  try {
    positionMode = await getFuturesUserPositionMode(creds);
  } catch {
    return null;
  }

  const partialPct = Math.min(99, Math.max(1, p.tp1PartialPct));
  const tp1Vol = roundVolDown(holdVol * (partialPct / 100), detail);
  let tp2Vol = roundVolDown(Math.max(0, holdVol - tp1Vol), detail);
  if (tp2Vol <= 0 && tp1Vol < holdVol) {
    tp2Vol = roundVolDown(holdVol, detail);
  }
  if (tp1Vol <= 0 && tp2Vol <= 0) return null;

  const tp1Trigger = favorableTpTriggerPrice(p.side, entry, p.tp1PricePct);
  const tp2Trigger = favorableTpTriggerPrice(p.side, entry, p.tp2PricePct);
  if (!(tp1Trigger > 0) || !(tp2Trigger > 0) || tp2Trigger <= tp1Trigger && p.side === "long") {
    return null;
  }
  if (p.side === "short" && tp2Trigger >= tp1Trigger) {
    return null;
  }

  const notifyLines: string[] = [];
  const warnings: string[] = [];
  let tp1PlanOrderId: string | undefined;
  let tp2PlanOrderId: string | undefined;

  if (tp1Vol > 0) {
    const r1 = await placePlanOrderTakeProfit(creds, {
      contractSymbol: sym,
      position: p.position,
      vol: tp1Vol,
      triggerPrice: tp1Trigger,
      positionMode,
    });
    tp1PlanOrderId = extractPlanOrderId(r1);
    if (tp1PlanOrderId) {
      notifyLines.push(
        `📌 Plan TP1: +${p.tp1PricePct}% @ ${fmtAutoTradeTpPrice(tp1Trigger)} · vol ${tp1Vol} (${partialPct}%)`,
      );
    } else {
      warnings.push(
        `TP1 plan ไม่สำเร็จ${r1.message ? `: ${r1.message}` : r1.code != null ? ` (code ${r1.code})` : ""}`,
      );
    }
  }

  const posForTp2: OpenPositionRow = { ...p.position, holdVol: tp2Vol > 0 ? tp2Vol : holdVol };
  if (tp2Vol > 0) {
    const r2 = await placePlanOrderTakeProfit(creds, {
      contractSymbol: sym,
      position: posForTp2,
      vol: tp2Vol,
      triggerPrice: tp2Trigger,
      positionMode,
    });
    tp2PlanOrderId = extractPlanOrderId(r2);
    if (tp2PlanOrderId) {
      notifyLines.push(
        `📌 Plan TP2: +${p.tp2PricePct}% @ ${fmtAutoTradeTpPrice(tp2Trigger)} · vol ${tp2Vol}`,
      );
    } else {
      warnings.push(
        `TP2 plan ไม่สำเร็จ${r2.message ? `: ${r2.message}` : r2.code != null ? ` (code ${r2.code})` : ""}`,
      );
    }
  }

  if (!tp1PlanOrderId && !tp2PlanOrderId) return null;

  return {
    tp1PlanOrderId,
    tp2PlanOrderId,
    initialHoldVol: holdVol,
    tp1TriggerPrice: tp1Trigger,
    tp2TriggerPrice: tp2Trigger,
    tp1Vol,
    tp2Vol,
    notifyLines,
    warnings,
  };
}

export function activeHasExchangeTpPlans(active: {
  tp1PlanOrderId?: string;
  tp2PlanOrderId?: string;
}): boolean {
  return Boolean(active.tp1PlanOrderId?.trim() || active.tp2PlanOrderId?.trim());
}

export async function cancelActiveTpSlPlanOrders(
  creds: MexcCredentials,
  active: { slPlanOrderId?: string; tp1PlanOrderId?: string; tp2PlanOrderId?: string },
): Promise<void> {
  const ids = [active.tp1PlanOrderId, active.tp2PlanOrderId, active.slPlanOrderId].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (ids.length === 0) return;
  try {
    await cancelPlanOrders(creds, ids);
  } catch (e) {
    console.error("[autoTradeTpSl] cancel plan orders", e);
  }
}

/** ยกเลิกเฉพาะ plan SL */
export async function cancelActiveSlPlanOrder(
  creds: MexcCredentials,
  slPlanOrderId?: string,
): Promise<void> {
  const id = typeof slPlanOrderId === "string" ? slPlanOrderId.trim() : "";
  if (!id) return;
  try {
    await cancelPlanOrders(creds, [id]);
  } catch (e) {
    console.error("[autoTradeTpSl] cancel SL plan order", e);
  }
}

/** ยกเลิกเฉพาะ plan TP (ก่อน partial close ด้วย tick) */
export async function cancelActiveTpPlanOrders(
  creds: MexcCredentials,
  active: { tp1PlanOrderId?: string; tp2PlanOrderId?: string },
): Promise<void> {
  const ids = [active.tp1PlanOrderId, active.tp2PlanOrderId].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (ids.length === 0) return;
  try {
    await cancelPlanOrders(creds, ids);
  } catch (e) {
    console.error("[autoTradeTpSl] cancel TP plan orders", e);
  }
}

/** tick ปิด TP1 ด้วย mark เมื่อยังไม่ tp1Done และราคาถึงเกณฑ์ */
export function shouldExecuteMarkTp1Fallback(input: {
  tp1Done: boolean;
  exchangeTp1: boolean;
  movePct: number;
  tp1PricePct: number;
  initialHoldVol?: number;
  tp1PlanVol?: number;
  currentHoldVol: number;
}): boolean {
  if (input.tp1Done) return false;
  if (!Number.isFinite(input.movePct) || input.movePct < input.tp1PricePct) return false;
  if (!input.exchangeTp1) return true;
  return !tp1PlanLikelyFilled(input.initialHoldVol, input.tp1PlanVol, input.currentHoldVol);
}

/** TP1 plan น่าจะ execute แล้ว — holdVol ลดลงจากตอนเปิด */
export function tp1PlanLikelyFilled(
  initialHoldVol: number | undefined,
  tp1Vol: number | undefined,
  currentHoldVol: number,
): boolean {
  if (
    typeof initialHoldVol !== "number" ||
    !Number.isFinite(initialHoldVol) ||
    !(initialHoldVol > 0) ||
    !(currentHoldVol >= 0)
  ) {
    return false;
  }
  if (typeof tp1Vol === "number" && tp1Vol > 0) {
    return currentHoldVol <= initialHoldVol - tp1Vol + 1e-9;
  }
  return currentHoldVol < initialHoldVol * 0.99;
}
