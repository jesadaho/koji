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
  /** 1 = long, 2 = short (MEXC futures) */
  positionType: number;
  /** 1 = isolated, 2 = cross */
  openType: number;
  state: number;
  holdVol: number;
  holdAvgPrice?: number;
  openAvgPrice?: number;
  leverage?: number;
  liquidatePrice?: number;
  im?: number;
  oim?: number;
  /** API: current position margin ratio (often a small decimal, e.g. 0.0027) */
  marginRatio?: number;
  realised?: number;
  profitRatio?: number;
  holdFee?: number;
  closeProfitLoss?: number;
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

export type MexcFuturesAssetRow = {
  currency?: string;
  availableBalance?: number | string;
  equity?: number | string;
  unrealized?: number | string;
  positionMargin?: number | string;
  cashBalance?: number | string;
  frozenBalance?: number | string;
};

export async function fetchFuturesAccountAssetList(
  creds: MexcCredentials
): Promise<{ ok: true; rows: MexcFuturesAssetRow[] } | { ok: false; code?: number; message: string }> {
  const res = await mexcPrivateGet<MexcFuturesAssetRow[]>(creds, "/api/v1/private/account/assets");
  if (!res.success) {
    return {
      ok: false,
      code: res.code,
      message:
        typeof res.message === "string" && res.message.trim() ? res.message.trim() : `code ${res.code}`,
    };
  }
  return { ok: true, rows: Array.isArray(res.data) ? res.data : [] };
}

/**
 * ทุกสัญญาที่เปิด — ไม่ส่ง symbol filter (ตาม MEXC GET open_positions)
 */
export async function fetchAllOpenPositions(
  creds: MexcCredentials
): Promise<{ ok: true; rows: OpenPositionRow[] } | { ok: false; code?: number; message: string }> {
  const res = await mexcPrivateGet<OpenPositionRow[]>(creds, "/api/v1/private/position/open_positions");
  if (!res.success) {
    return {
      ok: false,
      code: res.code,
      message:
        typeof res.message === "string" && res.message.trim() ? res.message.trim() : `code ${res.code}`,
    };
  }
  return { ok: true, rows: Array.isArray(res.data) ? res.data : [] };
}

export type MexcApiVerifyOk = {
  ok: true;
  usdtAvailable: string;
  positionModeLabel: string;
  openPositionsCount: number;
  openSymbolsSample: string[];
};

export type MexcApiVerifyFail = {
  ok: false;
  step: "network" | "account_assets" | "position_mode" | "open_positions";
  code?: number;
  message: string;
};

/**
 * ลองเรียก futures private จริง: ทรัพย์สิน → โหมด position → รายการ position เปิด
 */
export async function verifyMexcFuturesApiForUser(
  creds: MexcCredentials
): Promise<MexcApiVerifyOk | MexcApiVerifyFail> {
  let assets: MexcOk<MexcFuturesAssetRow[]>;
  try {
    assets = await mexcPrivateGet<MexcFuturesAssetRow[]>(creds, "/api/v1/private/account/assets");
  } catch (e) {
    return {
      ok: false,
      step: "network",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (!assets.success) {
    return {
      ok: false,
      step: "account_assets",
      code: assets.code,
      message: typeof assets.message === "string" && assets.message.trim()
        ? assets.message
        : `code ${assets.code}`,
    };
  }
  const list = Array.isArray(assets.data) ? assets.data : [];
  const usdt = list.find((r) => String(r.currency ?? "").toUpperCase() === "USDT");
  const usdtAvail =
    usdt?.availableBalance != null && usdt.availableBalance !== ""
      ? String(usdt.availableBalance)
      : "—";

  let positionModeLabel = "—";
  try {
    const modeRes = await mexcPrivateGet<{ positionMode?: number }>(
      creds,
      "/api/v1/private/position/position_mode"
    );
    if (!modeRes.success) {
      return {
        ok: false,
        step: "position_mode",
        code: modeRes.code,
        message:
          typeof modeRes.message === "string" && modeRes.message.trim()
            ? modeRes.message
            : `code ${modeRes.code}`,
      };
    }
    const d = modeRes.data;
    if (d && typeof d === "object" && d !== null && "positionMode" in d) {
      const pm = Number((d as { positionMode: unknown }).positionMode);
      positionModeLabel = pm === 2 ? "one-way" : pm === 1 ? "dual-side" : String(pm);
    } else {
      positionModeLabel = "dual-side";
    }
  } catch (e) {
    return {
      ok: false,
      step: "network",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  let openPositionsCount = 0;
  let openSymbolsSample: string[] = [];
  try {
    const posRes = await mexcPrivateGet<OpenPositionRow[]>(creds, "/api/v1/private/position/open_positions");
    if (!posRes.success) {
      return {
        ok: false,
        step: "open_positions",
        code: posRes.code,
        message:
          typeof posRes.message === "string" && posRes.message.trim()
            ? posRes.message
            : `code ${posRes.code}`,
      };
    }
    const rows = Array.isArray(posRes.data) ? posRes.data : [];
    const actives = rows.filter((p) => p.state === 1 && Number(p.holdVol) > 0);
    openPositionsCount = actives.length;
    openSymbolsSample = Array.from(new Set(actives.map((p) => p.symbol))).slice(0, 8);
  } catch (e) {
    return {
      ok: false,
      step: "open_positions",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    ok: true,
    usdtAvailable: usdtAvail,
    positionModeLabel,
    openPositionsCount,
    openSymbolsSample,
  };
}

/** ราคา last จาก public ticker สำหรับ market order (contract symbol เช่น BTC_USDT) */
export async function getContractLastPricePublic(symbol: string): Promise<number | null> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/ticker`;
  try {
    const { data } = await axios.get<{
      success: boolean;
      data?:
        | { symbol?: string; lastPrice?: number; fairPrice?: number; riseFallRate?: number; change24hPercent?: number }
        | { symbol?: string; lastPrice?: number; fairPrice?: number; riseFallRate?: number; change24hPercent?: number }[];
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

export async function getContractTickerPublic(symbol: string): Promise<{ lastPrice: number; change24hPercent: number | null } | null> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/ticker`;
  try {
    const { data } = await axios.get<{
      success: boolean;
      data?:
        | { symbol?: string; lastPrice?: number; fairPrice?: number; riseFallRate?: number; change24hPercent?: number }
        | { symbol?: string; lastPrice?: number; fairPrice?: number; riseFallRate?: number; change24hPercent?: number }[];
    }>(url, { params: { symbol }, timeout: 15_000, validateStatus: () => true });
    if (!data?.success) return null;
    const row = data.data;
    const one = Array.isArray(row) ? (row.find((r) => r.symbol === symbol) ?? row[0]) : row;
    if (!one || typeof one !== "object") return null;
    const lp = (one as { lastPrice?: number; fairPrice?: number }).lastPrice ?? (one as { fairPrice?: number }).fairPrice;
    const lastPrice = typeof lp === "number" && Number.isFinite(lp) && lp > 0 ? lp : null;
    if (lastPrice == null) return null;
    const rf = (one as { riseFallRate?: number }).riseFallRate;
    const ch = (one as { change24hPercent?: number }).change24hPercent;
    const pct =
      typeof rf === "number" && Number.isFinite(rf) ? rf * 100 :
      typeof ch === "number" && Number.isFinite(ch) ? ch :
      null;
    return { lastPrice, change24hPercent: pct };
  } catch {
    return null;
  }
}

export type OrderCreateData = { orderId?: string; ts?: number };

/** จาก public GET /api/v1/contract/detail?symbol= */
export type MexcContractDetailPublic = {
  symbol?: string;
  contractSize?: number;
  minVol?: number;
  maxVol?: number;
  volUnit?: number;
  volScale?: number;
  minLeverage?: number;
  maxLeverage?: number;
};

export async function fetchContractDetailPublic(
  contractSymbol: string
): Promise<MexcContractDetailPublic | null> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/detail`;
  try {
    const { data } = await axios.get<MexcOk<MexcContractDetailPublic | MexcContractDetailPublic[]>>(url, {
      params: { symbol: contractSymbol.trim() },
      timeout: 30_000,
      validateStatus: () => true,
    });
    if (!data?.success || data.data === undefined || data.data === null) return null;
    const d = data.data;
    if (Array.isArray(d)) {
      const one = d.find((x) => x.symbol === contractSymbol.trim()) ?? d[0];
      return one ?? null;
    }
    return d as MexcContractDetailPublic;
  } catch {
    return null;
  }
}

/**
 * notional USDT ≈ vol * contractSize * price (linear USDT-M)
 */
export function computeOpenVolFromNotionalUsdt(
  notionalUsdt: number,
  markPrice: number,
  detail: MexcContractDetailPublic
): { vol: number } | { error: string } {
  const cs = Number(detail.contractSize);
  const minV = Number(detail.minVol);
  const maxV = Number(detail.maxVol);
  const volScale = Number.isFinite(Number(detail.volScale)) ? Math.max(0, Math.floor(Number(detail.volScale))) : 0;
  if (!(notionalUsdt > 0) || !(markPrice > 0) || !(cs > 0)) {
    return { error: "ราคา/สัญญา/notional ไม่ถูกต้อง" };
  }
  const rawVol = notionalUsdt / (cs * markPrice);
  const factor = 10 ** volScale;
  let vol = Math.floor(rawVol * factor + 1e-12) / factor;
  if (!Number.isFinite(vol) || vol <= 0) {
    return { error: "คำนวณ vol ไม่ได้" };
  }
  if (Number.isFinite(minV) && vol < minV) {
    return { error: `vol น้อยกว่าขั้นต่ำของสัญญา (minVol ${minV})` };
  }
  if (Number.isFinite(maxV) && vol > maxV) {
    vol = maxV;
  }
  const vu = Number(detail.volUnit);
  if (Number.isFinite(vu) && vu > 0) {
    vol = Math.floor(vol / vu) * vu;
    if (vol < (Number.isFinite(minV) ? minV : 1)) {
      return { error: "vol หลังปัดตาม volUnit ต่ำเกินไป" };
    }
  }
  return { vol };
}

/**
 * เปิด market: side 1 long, 3 short — notionalUsdt = marginUsdt * leverage (ประมาณมูลค่า position)
 */
export async function createOpenMarketOrder(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    long: boolean;
    marginUsdt: number;
    leverage: number;
    openType?: 1 | 2;
  }
): Promise<MexcOk<OrderCreateData>> {
  const symbol = p.contractSymbol.trim();
  const margin = p.marginUsdt;
  const levIn = Math.floor(p.leverage);
  if (!(margin > 0) || levIn < 1) {
    return { success: false, code: -1, message: "margin หรือ leverage ไม่ถูกต้อง" };
  }

  const detail = await fetchContractDetailPublic(symbol);
  if (!detail) {
    return { success: false, code: -1, message: "ดึง contract detail ไม่ได้" };
  }

  const minLev = Number(detail.minLeverage) || 1;
  const maxLev = Number(detail.maxLeverage) || 500;
  const lev = Math.min(maxLev, Math.max(minLev, levIn));

  const mark = await getContractLastPricePublic(symbol);
  if (mark == null || !(mark > 0)) {
    return { success: false, code: -1, message: "ดึงราคาไม่ได้" };
  }

  const notionalUsdt = margin * lev;
  const volResult = computeOpenVolFromNotionalUsdt(notionalUsdt, mark, detail);
  if ("error" in volResult) {
    return { success: false, code: -1, message: volResult.error };
  }
  const vol = volResult.vol;

  const positionMode = await getFuturesUserPositionMode(creds);
  const openType: 1 | 2 = p.openType === 1 ? 1 : 2;
  const side = p.long ? 1 : 3;

  const body: Record<string, unknown> = {
    symbol,
    price: mark,
    vol,
    side,
    type: 5,
    openType,
    leverage: lev,
    positionMode,
  };

  return mexcPrivatePost<OrderCreateData>(creds, "/api/v1/private/order/create", body);
}

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
