import { computePositionUnrealizedFromMark } from "@/src/pctTrailingAlertUtils";
import type { OpenPositionRow } from "@/src/mexcFuturesClient";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { mexcPositionTypeForSide } from "@/lib/autoOpenMexcRealPnl";

/** Snapshot จาก MEXC open position — ใช้คำนวณ live P/L ตอน mark อัปเดต */
export type AutoOpenMexcOpenPnlSnapshot = {
  realisedUsdt: number;
  holdFeeUsdt: number;
  holdVol: number;
  positionType: 1 | 2;
  holdAvgPrice: number;
  contractSize: number | null;
  /** realised + closeProfitLoss + holdFee เมื่อไม่มี contractSize สำหรับ mark */
  fallbackTotalUsdt: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function findMexcOpenPositionForRow(
  openPositions: OpenPositionRow[],
  contractSymbol: string,
  side: "long" | "short",
): OpenPositionRow | null {
  const sym = contractSymbol.trim().toUpperCase();
  const wantType = mexcPositionTypeForSide(side);
  return (
    openPositions.find(
      (p) =>
        p.symbol === sym &&
        p.state === 1 &&
        Number(p.holdVol) > 0 &&
        p.positionType === wantType,
    ) ?? null
  );
}

export function buildMexcOpenPnlSnapshot(
  pos: OpenPositionRow,
  contractSize: number | null | undefined,
  markPrice?: number | null,
): AutoOpenMexcOpenPnlSnapshot | null {
  const holdVol = num(pos.holdVol);
  const avgRaw = num(pos.holdAvgPrice) ?? num(pos.openAvgPrice);
  const positionType = pos.positionType === 1 ? 1 : pos.positionType === 2 ? 2 : null;
  if (holdVol == null || !(holdVol > 0) || avgRaw == null || !(avgRaw > 0) || positionType == null) {
    return null;
  }

  const realisedUsdt = num(pos.realised) ?? 0;
  const holdFeeUsdt = num(pos.holdFee) ?? 0;
  const closeProfitLoss = num(pos.closeProfitLoss);
  const cs =
    contractSize != null && Number.isFinite(contractSize) && contractSize > 0 ? contractSize : null;

  let fallbackTotalUsdt: number | null = null;
  if (closeProfitLoss != null) {
    fallbackTotalUsdt = realisedUsdt + holdFeeUsdt + closeProfitLoss;
  } else if (markPrice != null && markPrice > 0 && cs != null) {
    const { unrealizedUsdt } = computePositionUnrealizedFromMark(
      { positionType, holdVol, holdAvgPrice: avgRaw },
      markPrice,
      cs,
    );
    if (unrealizedUsdt != null) {
      fallbackTotalUsdt = realisedUsdt + holdFeeUsdt + unrealizedUsdt;
    }
  }

  return {
    realisedUsdt,
    holdFeeUsdt,
    holdVol,
    positionType,
    holdAvgPrice: avgRaw,
    contractSize: cs,
    fallbackTotalUsdt,
  };
}

/** P/L รวมจาก MEXC ขณะ position ยังเปิด (realised ส่วนที่ปิดแล้ว + floating ส่วนที่เหลือ + funding) */
export function mexcLivePnlFromSnapshot(
  snap: AutoOpenMexcOpenPnlSnapshot,
  markPrice?: number | null,
): number | null {
  if (snap.contractSize != null && markPrice != null && markPrice > 0) {
    const { unrealizedUsdt } = computePositionUnrealizedFromMark(
      {
        positionType: snap.positionType,
        holdVol: snap.holdVol,
        holdAvgPrice: snap.holdAvgPrice,
      },
      markPrice,
      snap.contractSize,
    );
    if (unrealizedUsdt != null) {
      return snap.realisedUsdt + snap.holdFeeUsdt + unrealizedUsdt;
    }
  }
  return snap.fallbackTotalUsdt;
}

export function resolveAutoOpenMexcLivePnlUsdt(
  row: AutoOpenOrderLogRow,
  markPrice?: number | null,
): number | null {
  if (row.mexcRealisedPnlUsdt != null && Number.isFinite(row.mexcRealisedPnlUsdt)) {
    return row.mexcRealisedPnlUsdt;
  }
  if (!row.mexcActive || !row.mexcOpenPnlSnapshot) return null;
  return mexcLivePnlFromSnapshot(row.mexcOpenPnlSnapshot, markPrice);
}
