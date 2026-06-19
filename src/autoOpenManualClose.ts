import { autoOpenMexcActiveKey } from "@/lib/autoOpenMexcActive";
import type { AutoOpenSource } from "@/lib/autoOpenOrderLogClient";
import { cancelActiveTpSlPlanOrders } from "./autoTradeTpSlPlanOrders";
import { listAutoOpenOrderLogsForUser } from "./autoOpenOrderLogStore";
import { attachAutoOpenMexcActiveFlags, resolveAutoOpenMexcOpenContextForUser } from "./autoOpenMexcActiveForUser";
import {
  closeOpenPositionForSymbolSide,
  getContractLastPricePublic,
  type MexcCredentials,
} from "./mexcFuturesClient";
import {
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveRemoved,
} from "./reversalAutoTradeStateStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
} from "./snowballAutoTradeStateStore";
import { ensureTradingViewMexcUserRow } from "./tradingViewCloseSettingsStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function sourceLabel(source: AutoOpenSource): string {
  return source === "snowball" ? "Snowball" : "Reversal";
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function findBotActive(
  source: AutoOpenSource,
  snowballState: Awaited<ReturnType<typeof loadSnowballAutoTradeState>>,
  reversalState: Awaited<ReturnType<typeof loadReversalAutoTradeState>>,
  userId: string,
  contractSymbol: string,
  side: "long" | "short",
): { slPlanOrderId?: string; tp1PlanOrderId?: string; tp2PlanOrderId?: string } | null {
  const sym = contractSymbol.trim().toUpperCase();
  if (source === "snowball") {
    const hit = (snowballState[userId]?.active ?? []).find(
      (a) => a.contractSymbol.trim().toUpperCase() === sym && a.side === side,
    );
    return hit ?? null;
  }
  const hit = (reversalState[userId]?.active ?? []).find(
    (a) => a.contractSymbol.trim().toUpperCase() === sym && a.side === side,
  );
  return hit ?? null;
}

export type ManualCloseAutoOpenResult =
  | { ok: true; alreadyClosed?: boolean }
  | { ok: false; status: number; error: string };

export async function manualCloseAutoOpenPosition(
  userId: string,
  logId: string,
): Promise<ManualCloseAutoOpenResult> {
  const uid = userId.trim();
  const id = logId.trim();
  if (!uid || !id) {
    return { ok: false, status: 400, error: "logId ไม่ถูกต้อง" };
  }

  const rows = await listAutoOpenOrderLogsForUser(uid);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return { ok: false, status: 404, error: "ไม่พบรายการในประวัติ" };
  }
  if (row.outcome !== "success") {
    return { ok: false, status: 400, error: "ปิดได้เฉพาะไม้ที่เปิดสำเร็จบน MEXC" };
  }
  if (row.side !== "long" && row.side !== "short") {
    return { ok: false, status: 400, error: "ทิศ position ไม่ถูกต้อง" };
  }

  const mexcCtx = await resolveAutoOpenMexcOpenContextForUser(uid);
  const [annotated] = await attachAutoOpenMexcActiveFlags(uid, [row]);
  if (!annotated?.mexcActive) {
    const key = autoOpenMexcActiveKey(row.contractSymbol, row.side);
    if (!mexcCtx.activeKeys.has(key)) {
      return { ok: true, alreadyClosed: true };
    }
    return { ok: false, status: 400, error: "รายการนี้ไม่ใช่ position ที่เปิดอยู่ล่าสุดของเหรียญ+ทิศ" };
  }

  const settingsRow = await ensureTradingViewMexcUserRow(uid);
  const apiKey = settingsRow.mexcApiKey?.trim();
  const secret = settingsRow.mexcSecret?.trim();
  if (!apiKey || !secret) {
    return { ok: false, status: 400, error: "ยังไม่ได้ตั้ง MEXC API ใน Settings" };
  }
  const creds: MexcCredentials = { apiKey, secret };

  const contractSymbol = row.contractSymbol.trim().toUpperCase();
  const side = row.side;
  const source = row.source;

  const [snowballState0, reversalState0] = await Promise.all([
    loadSnowballAutoTradeState(),
    loadReversalAutoTradeState(),
  ]);
  let snowballState = snowballState0;
  let reversalState = reversalState0;

  const botActive = findBotActive(source, snowballState, reversalState, uid, contractSymbol, side);
  if (botActive) {
    await cancelActiveTpSlPlanOrders(creds, botActive);
  }

  const r = await closeOpenPositionForSymbolSide(creds, contractSymbol, side);
  if (r.message === "no_open_position") {
    if (botActive) {
      if (source === "snowball") {
        snowballState = withSnowballActiveRemoved(snowballState, uid, contractSymbol, side);
        await saveSnowballAutoTradeState(snowballState);
      } else {
        reversalState = withReversalActiveRemoved(reversalState, uid, contractSymbol, side);
        await saveReversalAutoTradeState(reversalState);
      }
    }
    return { ok: true, alreadyClosed: true };
  }
  if (!r.success) {
    const detail = r.closed.find((c) => c.error)?.error;
    await notifyLines(uid, [
      "Koji — ปิด position ด้วยตนเอง (Mini App)",
      "❌ ปิดไม่สำเร็จ",
      `[${shortContractLabel(contractSymbol)}]/USDT (${side.toUpperCase()}) · ${sourceLabel(source)}`,
      detail ? `MEXC: ${detail}` : r.message ? `MEXC: ${r.message}` : "",
    ]);
    return {
      ok: false,
      status: 502,
      error: detail ?? r.message ?? "ปิด position บน MEXC ไม่สำเร็จ",
    };
  }

  if (botActive) {
    if (source === "snowball") {
      snowballState = withSnowballActiveRemoved(snowballState, uid, contractSymbol, side);
      await saveSnowballAutoTradeState(snowballState);
    } else {
      reversalState = withReversalActiveRemoved(reversalState, uid, contractSymbol, side);
      await saveReversalAutoTradeState(reversalState);
    }
  }

  const mark = (await getContractLastPricePublic(contractSymbol)) ?? NaN;
  await notifyLines(uid, [
    "Koji — ปิด position ด้วยตนเอง (Mini App)",
    "✅ ปิดโพซิชันแล้ว",
    `[${shortContractLabel(contractSymbol)}]/USDT (${side.toUpperCase()}) · ${sourceLabel(source)}`,
    Number.isFinite(mark) ? `Mark: ${fmtPrice(mark)} USDT` : "",
    botActive ? "เคลียร์ state บอทแล้ว" : "ไม่อยู่ใน state บอท — ปิดจาก MEXC โดยตรง",
  ]);

  return { ok: true };
}
