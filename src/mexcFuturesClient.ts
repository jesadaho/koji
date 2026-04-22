import { createHmac } from "node:crypto";
import axios from "axios";

const DEFAULT_BASE = "https://api.mexc.com";

export function mexcFuturesBaseUrl(): string {
  const b = process.env.MEXC_FUTURES_API_BASE_URL?.trim();
  return b && b.startsWith("http") ? b.replace(/\/$/, "") : DEFAULT_BASE;
}

type MexcOk<T> = { success: boolean; code: number; data?: T; message?: string };

function signHmac256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * MEXC Futures OPEN-API: target = accessKey + timestamp + parameterString
 * GET: เรียงพารามิเตอร์ key ตาม a-z แล้ว a=b&c=d
 * POST: parameterString = JSON ของ body (ตามตัวที่ส่ง)
 */
function buildGetParamString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export type MexcCredentials = {
  apiKey: string;
  secret: string;
};

type PrivateHeaders = {
  ApiKey: string;
  "Request-Time": string;
  Signature: string;
  "Content-Type"?: string;
  "Recv-Window"?: string;
};

function recvWindowStr(): string {
  const w = process.env.MEXC_FUTURES_RECV_WINDOW;
  if (w && /^\d+$/.test(w)) return w;
  return "60";
}

function privateHeaders(
  accessKey: string,
  secret: string,
  requestTimeMs: string,
  signature: string
): PrivateHeaders {
  return {
    ApiKey: accessKey,
    "Request-Time": requestTimeMs,
    Signature: signature,
    "Recv-Window": recvWindowStr(),
  };
}

export async function mexcPrivateGet<T>(
  creds: MexcCredentials,
  path: string,
  query?: Record<string, string | number | undefined>
): Promise<MexcOk<T>> {
  const requestTime = String(Date.now());
  const paramString = query ? buildGetParamString(query) : "";
  const toSign = `${creds.apiKey}${requestTime}${paramString}`;
  const sig = signHmac256(creds.secret, toSign);
  const base = mexcFuturesBaseUrl();
  const url = paramString ? `${base}${path}?${paramString}` : `${base}${path}`;

  const { data } = await axios.get<MexcOk<T>>(url, {
    timeout: 45_000,
    headers: { ...privateHeaders(creds.apiKey, creds.secret, requestTime, sig) },
    validateStatus: () => true,
  });
  return data;
}

export async function mexcPrivatePost<T>(
  creds: MexcCredentials,
  path: string,
  body: Record<string, unknown>
): Promise<MexcOk<T>> {
  const requestTime = String(Date.now());
  const paramString = JSON.stringify(body);
  const toSign = `${creds.apiKey}${requestTime}${paramString}`;
  const sig = signHmac256(creds.secret, toSign);
  const base = mexcFuturesBaseUrl();

  const { data } = await axios.post<MexcOk<T>>(`${base}${path}`, body, {
    timeout: 45_000,
    headers: {
      ...privateHeaders(creds.apiKey, creds.secret, requestTime, sig),
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  return data;
}

export type OpenPositionRow = {
  positionId: number;
  symbol: string;
  positionType: number;
  openType: number;
  state: number;
  holdVol: number;
  holdAvgPrice?: number;
  leverage?: number;
};

/**
 * 1 = dual, 2 = one-way
 */
export async function getFuturesUserPositionMode(creds: MexcCredentials): Promise<1 | 2> {
  const res = await mexcPrivateGet<unknown>(creds, "/api/v1/private/position/position_mode");
  if (!res.success) return 1;
  const d = res.data;
  if (d && typeof d === "object" && d !== null && "positionMode" in d) {
    const m = Number((d as { positionMode: unknown }).positionMode);
    return m === 2 ? 2 : 1;
  }
  return 1;
}

export async function getOpenPositions(
  creds: MexcCredentials,
  symbol: string
): Promise<OpenPositionRow[]> {
  const res = await mexcPrivateGet<OpenPositionRow[]>(creds, "/api/v1/private/position/open_positions", {
    symbol,
  });
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data;
}

/** ราคา last จาก public ticker สำหรับ market order (contract symbol เช่น BTC_USDT) */
export async function getContractLastPricePublic(symbol: string): Promise<number | null> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/ticker`;
  try {
    const { data } = await axios.get<{
      success: boolean;
      data?: { symbol?: string; lastPrice?: number; fairPrice?: number } | { symbol?: string; lastPrice?: number; fairPrice?: number }[];
    }>(url, { params: { symbol }, timeout: 15_000, validateStatus: () => true });
    if (!data?.success) return null;
    const row = data.data;
    if (Array.isArray(row)) {
      const one = row.find((r) => r.symbol === symbol) ?? row[0];
      const p = one?.lastPrice ?? one?.fairPrice;
      return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
    }
    if (row && typeof row === "object") {
      const p = (row as { lastPrice?: number; fairPrice?: number }).lastPrice;
      const q = p ?? (row as { fairPrice?: number }).fairPrice;
      return typeof q === "number" && Number.isFinite(q) && q > 0 ? q : null;
    }
  } catch {
    return null;
  }
  return null;
}

export type OrderCreateData = { orderId?: string; ts?: number };

/**
 * ปิด position: side 2 = close short, 4 = close long; type 5 = market; flashClose ลด slippageตาม platform
 */
export async function createCloseOrder(
  creds: MexcCredentials,
  p: {
    symbol: string;
    position: OpenPositionRow;
    markPrice: number;
    positionMode: 1 | 2;
  }
): Promise<MexcOk<OrderCreateData>> {
  const { position } = p;
  const vol = position.holdVol;
  if (typeof vol !== "number" || !Number.isFinite(vol) || vol <= 0) {
    return { success: false, code: -1, message: "holdVol ไม่ถูกต้อง" };
  }
  // 1 = long, 2 = short — close: long→4, short→2
  const side = position.positionType === 1 ? 4 : position.positionType === 2 ? 2 : 0;
  if (side === 0) {
    return { success: false, code: -1, message: "positionType ไม่รองรับ" };
  }
  const openType = position.openType === 2 ? 2 : 1;
  const body: Record<string, unknown> = {
    symbol: p.symbol,
    price: p.markPrice,
    vol,
    side,
    type: 5,
    openType,
    flashClose: true,
    positionId: position.positionId,
  };
  if (position.leverage != null && Number.isFinite(position.leverage)) {
    body.leverage = position.leverage;
  }
  body.positionMode = p.positionMode;
  if (p.positionMode === 2) {
    body.reduceOnly = true;
  }
  return mexcPrivatePost<OrderCreateData>(creds, "/api/v1/private/order/create", body);
}

/**
 * ปิดทุก open position ของ symbol นี้ (state=1, holdVol>0)
 */
export async function closeAllOpenForSymbol(
  creds: MexcCredentials,
  contractSymbol: string
): Promise<{
  success: boolean;
  closed: { positionId: number; orderId?: string; error?: string }[];
  message?: string;
}> {
  const positionMode = await getFuturesUserPositionMode(creds);
  const positions = await getOpenPositions(creds, contractSymbol);
  const actives = positions.filter((x) => x.state === 1 && x.holdVol > 0 && x.symbol === contractSymbol);
  if (actives.length === 0) {
    return { success: true, closed: [], message: "no_open_position" };
  }
  const mark = await getContractLastPricePublic(contractSymbol);
  const markPrice = mark != null && mark > 0 ? mark : 1;
  const closed: { positionId: number; orderId?: string; error?: string }[] = [];
  for (const pos of actives) {
    const r = await createCloseOrder(creds, {
      symbol: contractSymbol,
      position: pos,
      markPrice,
      positionMode,
    });
    if (r.success) {
      const d = r.data;
      const oid = d && typeof d === "object" && d !== null && "orderId" in d
        ? String((d as { orderId: unknown }).orderId)
        : undefined;
      closed.push({ positionId: pos.positionId, orderId: oid });
    } else {
      closed.push({
        positionId: pos.positionId,
        error: r.message ?? `code ${r.code}`,
      });
    }
  }
  const allOk = closed.every((c) => !c.error);
  return {
    success: allOk,
    closed,
    message: allOk ? undefined : "some_orders_failed",
  };
}
