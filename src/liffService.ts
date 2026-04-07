import { config } from "./config";
import { verifyLiffIdToken } from "./liffAuth";
import { addAlert, listAlertsForUser, removeAlertById } from "./alertsStore";
import { resolveContractSymbol, BASE_TO_CONTRACT } from "./coinMap";
import { fetchSimplePrices, formatSignal } from "./cryptoService";

export function getLiffConfig() {
  return {
    liffId: config.liffId ?? null,
    channelIdConfigured: Boolean(config.lineChannelId),
  };
}

export function getLiffMeta() {
  return {
    shortcuts: Object.keys(BASE_TO_CONTRACT).sort(),
    hint: "พิมพ์ย่อ (btc) หรือสัญญาเต็ม (BTC_USDT)",
  };
}

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function authenticateLiffRequest(authHeader: string | null): Promise<AuthResult> {
  if (!config.lineChannelId) {
    return {
      ok: false,
      status: 503,
      error: "ตั้งค่า LINE_CHANNEL_ID ในเซิร์ฟเวอร์ก่อน (ใช้ยืนยัน LIFF)",
    };
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "ต้องล็อกอิน LINE" };
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return { ok: false, status: 401, error: "ต้องล็อกอิน LINE" };
  }
  try {
    const { userId } = await verifyLiffIdToken(idToken, config.lineChannelId);
    return { ok: true, userId };
  } catch {
    return {
      ok: false,
      status: 401,
      error: "โทเคนไม่ถูกต้องหรือหมดอายุ ลองปิดแล้วเปิดแอปใหม่",
    };
  }
}

export async function liffListAlerts(userId: string) {
  const list = await listAlertsForUser(userId);
  return { alerts: list };
}

export async function liffCreateAlert(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { symbol, direction, target } = (body ?? {}) as Record<string, unknown>;
  if (direction !== "above" && direction !== "below") {
    return { status: 400, json: { error: "direction ต้องเป็น above หรือ below" } };
  }
  const t = typeof target === "number" ? target : Number(target);
  if (!Number.isFinite(t) || t <= 0) {
    return { status: 400, json: { error: "target ต้องเป็นตัวเลขบวก" } };
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    return { status: 400, json: { error: "ระบุ symbol" } };
  }
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  const dir = direction as "above" | "below";
  const row = await addAlert({
    userId,
    coinId: resolved.contractSymbol,
    symbolLabel: resolved.label,
    direction: dir,
    targetUsd: t,
  });
  return { status: 201, json: { alert: row } };
}

export async function liffDeleteAlert(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removeAlertById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบการแจ้งเตือน" } };
  }
  return { status: 204 };
}

export async function liffPrice(symbol: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  try {
    const prices = await fetchSimplePrices([resolved.contractSymbol]);
    const quote = prices[resolved.contractSymbol];
    if (!quote) {
      return { status: 502, json: { error: "ดึงราคาไม่สำเร็จ" } };
    }
    return {
      status: 200,
      json: {
        contract: resolved.contractSymbol,
        priceUsdt: quote.usd,
        change24hPercent: quote.usd_24h_change,
        signal: formatSignal(quote.usd_24h_change),
      },
    };
  } catch {
    return { status: 502, json: { error: "MEXC ไม่พร้อม" } };
  }
}
