import { createHmac } from "node:crypto";
import axios from "axios";

const DEFAULT_BASE = "https://api.mexc.com";

export function mexcFuturesBaseUrl(): string {
  const b = process.env.MEXC_FUTURES_API_BASE_URL?.trim();
  return b && b.startsWith("http") ? b.replace(/\/$/, "") : DEFAULT_BASE;
}

export type MexcOk<T> = { success: boolean; code: number; data?: T; message?: string };

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

export type MexcUsdtBalanceSnapshot = {
  equityUsdt: number | null;
  availableUsdt: number | null;
};

function numFromAssetField(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseMexcUsdtBalanceFromAssets(rows: MexcFuturesAssetRow[]): MexcUsdtBalanceSnapshot {
  const usdt = rows.find((r) => String(r.currency ?? "").toUpperCase() === "USDT");
  return {
    equityUsdt: numFromAssetField(usdt?.equity),
    availableUsdt: numFromAssetField(usdt?.availableBalance),
  };
}

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

type MexcTickerRow = {
  symbol?: string;
  lastPrice?: number;
  fairPrice?: number;
  indexPrice?: number;
  riseFallRate?: number;
  change24hPercent?: number;
};

function numTickerPrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function pickTickerMarkPrice(row: MexcTickerRow | null | undefined): number | null {
  if (!row || typeof row !== "object") return null;
  return (
    numTickerPrice(row.lastPrice) ??
    numTickerPrice(row.fairPrice) ??
    numTickerPrice(row.indexPrice) ??
    null
  );
}

/** ราคา last จาก public ticker สำหรับ market order (contract symbol เช่น BTC_USDT) */
export async function getContractLastPricePublic(symbol: string): Promise<number | null> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/ticker`;
  try {
    const { data } = await axios.get<{
      success: boolean;
      data?: MexcTickerRow | MexcTickerRow[];
    }>(url, { params: { symbol }, timeout: 15_000, validateStatus: () => true });
    if (!data?.success) return null;
    const row = data.data;
    if (Array.isArray(row)) {
      const one = row.find((r) => r.symbol === symbol) ?? row[0];
      return pickTickerMarkPrice(one);
    }
    if (row && typeof row === "object") {
      return pickTickerMarkPrice(row);
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
      data?: MexcTickerRow & { symbol?: string } | Array<MexcTickerRow & { symbol?: string }>;
    }>(url, { params: { symbol }, timeout: 15_000, validateStatus: () => true });
    if (!data?.success) return null;
    const row = data.data;
    const one = Array.isArray(row) ? (row.find((r) => r.symbol === symbol) ?? row[0]) : row;
    const lastPrice = pickTickerMarkPrice(one);
    if (lastPrice == null) return null;
    const rf = one?.riseFallRate;
    const ch = one?.change24hPercent;
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
  /** ทศนิยมราคาที่ MEXC ยอมรับ */
  priceScale?: number;
  /** tick ราคา (เช่น 0.00001 สำหรับ SEI) */
  priceUnit?: number;
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
 * ปัดราคาให้ตรง priceUnit / priceScale ของสัญญา — ป้องกัน MEXC "Price or quantity precision error"
 */
export function roundMexcPrice(priceRaw: number, detail: MexcContractDetailPublic): number {
  if (!(priceRaw > 0) || !Number.isFinite(priceRaw)) return NaN;

  const priceUnit = Number(detail.priceUnit);
  if (Number.isFinite(priceUnit) && priceUnit > 0) {
    const steps = Math.round(priceRaw / priceUnit + 1e-9);
    let rounded = steps * priceUnit;
    const scale = Number(detail.priceScale);
    if (Number.isFinite(scale) && scale >= 0) {
      rounded = Number(rounded.toFixed(Math.min(20, Math.floor(scale))));
    }
    return rounded > 0 ? rounded : NaN;
  }

  const scale = Number(detail.priceScale);
  if (Number.isFinite(scale) && scale >= 0) {
    const factor = 10 ** Math.floor(scale);
    const rounded = Math.round(priceRaw * factor) / factor;
    return rounded > 0 ? rounded : NaN;
  }

  return priceRaw;
}

/**
 * เปิด market: side 1 long, 3 short — notionalUsdt = marginUsdt * leverage (ประมาณมูลค่า position)
 * openType default = 1 isolated (ถ้าต้องการ cross margin ให้ส่ง openType เป็น 2 ชัดเจน)
 */
export async function createOpenMarketOrder(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    long: boolean;
    marginUsdt: number;
    leverage: number;
    /** MEXC: 1 = isolated (default), 2 = cross */
    openType?: 1 | 2;
    /** TP จากราคา mark ประมาณการเข้า — MEXC place-order field */
    takeProfitPrice?: number;
    /** 1 latest (default); 2 fair; 3 index */
    profitTrend?: number;
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

  const markRaw = await getContractLastPricePublic(symbol);
  if (markRaw == null || !(markRaw > 0)) {
    return { success: false, code: -1, message: "ดึงราคาไม่ได้" };
  }
  const mark = roundMexcPrice(markRaw, detail);
  if (!(mark > 0)) {
    return { success: false, code: -1, message: "ปัดราคา mark ไม่ได้" };
  }

  const notionalUsdt = margin * lev;
  const volResult = computeOpenVolFromNotionalUsdt(notionalUsdt, mark, detail);
  if ("error" in volResult) {
    return { success: false, code: -1, message: volResult.error };
  }
  const vol = volResult.vol;

  const positionMode = await getFuturesUserPositionMode(creds);
  const openType: 1 | 2 = p.openType === 2 ? 2 : 1;
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

  const tp = p.takeProfitPrice;
  if (typeof tp === "number" && Number.isFinite(tp) && tp > 0) {
    const tpRounded = roundMexcPrice(tp, detail);
    if (tpRounded > 0) body.takeProfitPrice = tpRounded;
    const trend = Number(p.profitTrend);
    if (Number.isFinite(trend) && trend >= 1 && trend <= 3) body.profitTrend = trend;
  }

  return mexcPrivatePost<OrderCreateData>(creds, "/api/v1/private/order/create", body);
}

/**
 * เปิด limit: side 1 long, 3 short — type 1 limit (รอ fill ที่ราคาที่กำหนด)
 */
export async function createOpenLimitOrder(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    long: boolean;
    marginUsdt: number;
    leverage: number;
    limitPrice: number;
    openType?: 1 | 2;
    takeProfitPrice?: number;
    profitTrend?: number;
  }
): Promise<MexcOk<OrderCreateData>> {
  const symbol = p.contractSymbol.trim();
  const margin = p.marginUsdt;
  const levIn = Math.floor(p.leverage);
  const limitPrice = p.limitPrice;
  if (!(margin > 0) || levIn < 1) {
    return { success: false, code: -1, message: "margin หรือ leverage ไม่ถูกต้อง" };
  }
  if (!(limitPrice > 0) || !Number.isFinite(limitPrice)) {
    return { success: false, code: -1, message: "limitPrice ไม่ถูกต้อง" };
  }

  const detail = await fetchContractDetailPublic(symbol);
  if (!detail) {
    return { success: false, code: -1, message: "ดึง contract detail ไม่ได้" };
  }

  const minLev = Number(detail.minLeverage) || 1;
  const maxLev = Number(detail.maxLeverage) || 500;
  const lev = Math.min(maxLev, Math.max(minLev, levIn));

  const limitRounded = roundMexcPrice(limitPrice, detail);
  if (!(limitRounded > 0)) {
    return { success: false, code: -1, message: "ปัด limitPrice ไม่ได้" };
  }

  const notionalUsdt = margin * lev;
  const volResult = computeOpenVolFromNotionalUsdt(notionalUsdt, limitRounded, detail);
  if ("error" in volResult) {
    return { success: false, code: -1, message: volResult.error };
  }
  const vol = volResult.vol;

  const positionMode = await getFuturesUserPositionMode(creds);
  const openType: 1 | 2 = p.openType === 2 ? 2 : 1;
  const side = p.long ? 1 : 3;

  const body: Record<string, unknown> = {
    symbol,
    price: limitRounded,
    vol,
    side,
    type: 1,
    openType,
    leverage: lev,
    positionMode,
  };

  const tp = p.takeProfitPrice;
  if (typeof tp === "number" && Number.isFinite(tp) && tp > 0) {
    const tpRounded = roundMexcPrice(tp, detail);
    if (tpRounded > 0) body.takeProfitPrice = tpRounded;
    const trend = Number(p.profitTrend);
    if (Number.isFinite(trend) && trend >= 1 && trend <= 3) body.profitTrend = trend;
  }

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
 * ปัด vol ลงให้ตรงกับ volUnit + volScale ของ contract — ใช้คำนวณ partial close vol
 * คืน 0 ถ้าปัดแล้วต่ำกว่า minVol หรือผลลัพธ์ไม่ถูกต้อง
 */
export function roundVolDown(volRaw: number, detail: MexcContractDetailPublic): number {
  if (!(volRaw > 0) || !Number.isFinite(volRaw)) return 0;
  const volScale = Number.isFinite(Number(detail.volScale)) ? Math.max(0, Math.floor(Number(detail.volScale))) : 0;
  const minV = Number(detail.minVol);
  const factor = 10 ** volScale;
  let vol = Math.floor(volRaw * factor + 1e-12) / factor;
  if (!Number.isFinite(vol) || vol <= 0) return 0;
  const vu = Number(detail.volUnit);
  if (Number.isFinite(vu) && vu > 0) {
    vol = Math.floor(vol / vu) * vu;
  }
  if (Number.isFinite(minV) && vol < minV) return 0;
  return vol > 0 ? vol : 0;
}

/**
 * Partial close: เหมือน createCloseOrder แต่ระบุ vol เอง (ต้อง ≤ holdVol และปัดให้ตรง volUnit แล้ว)
 * ใช้ type 5 (market) + flashClose=false เพราะระบุ vol เอง (ไม่ใช่ปิดเต็ม)
 */
export async function createPartialCloseOrder(
  creds: MexcCredentials,
  p: {
    symbol: string;
    position: OpenPositionRow;
    vol: number;
    markPrice: number;
    positionMode: 1 | 2;
  }
): Promise<MexcOk<OrderCreateData>> {
  const { position } = p;
  if (!(p.vol > 0) || !Number.isFinite(p.vol)) {
    return { success: false, code: -1, message: "partial vol ไม่ถูกต้อง" };
  }
  if (!(position.holdVol > 0) || p.vol > position.holdVol) {
    return { success: false, code: -1, message: "partial vol > holdVol" };
  }
  const side = position.positionType === 1 ? 4 : position.positionType === 2 ? 2 : 0;
  if (side === 0) {
    return { success: false, code: -1, message: "positionType ไม่รองรับ" };
  }
  const openType = position.openType === 2 ? 2 : 1;
  const body: Record<string, unknown> = {
    symbol: p.symbol,
    price: p.markPrice,
    vol: p.vol,
    side,
    type: 5,
    openType,
    flashClose: false,
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

/** MEXC อาจคืน order id เป็น string โดยตรง หรือ object */
export type PlanOrderCreateData = string | { orderId?: string | number; ts?: number };

/**
 * วาง plan/trigger order (MEXC `/api/v1/private/planorder/place`)
 * สำหรับ "SL บังทุน" หลัง partial close:
 *   - SHORT (positionType=2) → close side = 2; triggerType = 1 (price ≥ triggerPrice)
 *   - LONG  (positionType=1) → close side = 4; triggerType = 2 (price ≤ triggerPrice)
 * executeCycle: 2 = 7 วัน · orderType: 5 = market
 */
export async function placePlanOrderStopLoss(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    position: OpenPositionRow;
    triggerPrice: number;
    positionMode: 1 | 2;
  }
): Promise<MexcOk<PlanOrderCreateData>> {
  const { position } = p;
  if (!(p.triggerPrice > 0) || !Number.isFinite(p.triggerPrice)) {
    return { success: false, code: -1, message: "triggerPrice ไม่ถูกต้อง" };
  }
  if (!(position.holdVol > 0) || !Number.isFinite(position.holdVol)) {
    return { success: false, code: -1, message: "holdVol ไม่ถูกต้อง" };
  }
  const isShort = position.positionType === 2;
  const isLong = position.positionType === 1;
  if (!isShort && !isLong) {
    return { success: false, code: -1, message: "positionType ไม่รองรับ" };
  }
  const sym = p.contractSymbol.trim();
  const detail = await fetchContractDetailPublic(sym);
  const trigger =
    detail != null ? roundMexcPrice(p.triggerPrice, detail) : p.triggerPrice;
  if (!(trigger > 0)) {
    return { success: false, code: -1, message: "ปัด triggerPrice ไม่ได้" };
  }
  const side = isShort ? 2 : 4;
  const triggerType = isShort ? 1 : 2;
  const openType = position.openType === 2 ? 2 : 1;
  const body: Record<string, unknown> = {
    symbol: sym,
    vol: position.holdVol,
    side,
    openType,
    triggerPrice: trigger,
    triggerType,
    executeCycle: 2,
    orderType: 5,
    trend: 1,
    price: trigger,
    positionMode: p.positionMode,
  };
  if (position.leverage != null && Number.isFinite(position.leverage)) {
    body.leverage = position.leverage;
  }
  if (p.positionMode === 2) {
    body.reduceOnly = true;
  }
  return mexcPrivatePost<PlanOrderCreateData>(creds, "/api/v1/private/planorder/place", body);
}

/**
 * วาง plan/trigger order ปิดทำกำไร (TP):
 *   - LONG  → close side 4; triggerType 1 (ราคา ≥ triggerPrice)
 *   - SHORT → close side 2; triggerType 2 (ราคา ≤ triggerPrice)
 */
export async function placePlanOrderTakeProfit(
  creds: MexcCredentials,
  p: {
    contractSymbol: string;
    position: OpenPositionRow;
    vol: number;
    triggerPrice: number;
    positionMode: 1 | 2;
  }
): Promise<MexcOk<PlanOrderCreateData>> {
  const { position } = p;
  if (!(p.triggerPrice > 0) || !Number.isFinite(p.triggerPrice)) {
    return { success: false, code: -1, message: "triggerPrice ไม่ถูกต้อง" };
  }
  if (!(p.vol > 0) || !Number.isFinite(p.vol)) {
    return { success: false, code: -1, message: "vol ไม่ถูกต้อง" };
  }
  if (p.vol > position.holdVol) {
    return { success: false, code: -1, message: "vol > holdVol" };
  }
  const isShort = position.positionType === 2;
  const isLong = position.positionType === 1;
  if (!isShort && !isLong) {
    return { success: false, code: -1, message: "positionType ไม่รองรับ" };
  }
  const sym = p.contractSymbol.trim();
  const detail = await fetchContractDetailPublic(sym);
  const trigger =
    detail != null ? roundMexcPrice(p.triggerPrice, detail) : p.triggerPrice;
  if (!(trigger > 0)) {
    return { success: false, code: -1, message: "ปัด triggerPrice ไม่ได้" };
  }
  const side = isShort ? 2 : 4;
  const triggerType = isShort ? 2 : 1;
  const openType = position.openType === 2 ? 2 : 1;
  const body: Record<string, unknown> = {
    symbol: sym,
    vol: p.vol,
    side,
    openType,
    triggerPrice: trigger,
    triggerType,
    executeCycle: 2,
    orderType: 5,
    trend: 1,
    price: trigger,
    positionMode: p.positionMode,
  };
  if (position.leverage != null && Number.isFinite(position.leverage)) {
    body.leverage = position.leverage;
  }
  if (p.positionMode === 2) {
    body.reduceOnly = true;
  }
  return mexcPrivatePost<PlanOrderCreateData>(creds, "/api/v1/private/planorder/place", body);
}

export type OpenOrderRow = {
  orderId: string;
  symbol: string;
  price: number;
  vol: number;
  leverage?: number;
  /** 1 open long, 2 close short, 3 open short, 4 close long */
  side: number;
  /** 1 pending, 2 unfilled, 3 filled, 4 canceled, 5 invalid */
  state: number;
  createTime?: number;
};

function parseOpenOrderRow(raw: unknown): OpenOrderRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const orderId =
    typeof o.orderId === "string"
      ? o.orderId.trim()
      : typeof o.orderId === "number" && Number.isFinite(o.orderId)
        ? String(o.orderId)
        : "";
  const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
  const price = typeof o.price === "number" && Number.isFinite(o.price) ? o.price : NaN;
  const vol = typeof o.vol === "number" && Number.isFinite(o.vol) ? o.vol : NaN;
  const side = typeof o.side === "number" && Number.isFinite(o.side) ? o.side : NaN;
  const state = typeof o.state === "number" && Number.isFinite(o.state) ? o.state : NaN;
  if (!orderId || !symbol || !Number.isFinite(price) || !Number.isFinite(vol) || !Number.isFinite(side)) {
    return null;
  }
  const row: OpenOrderRow = { orderId, symbol, price, vol, side, state: Number.isFinite(state) ? state : 0 };
  if (typeof o.leverage === "number" && Number.isFinite(o.leverage)) row.leverage = o.leverage;
  if (typeof o.createTime === "number" && Number.isFinite(o.createTime)) row.createTime = o.createTime;
  return row;
}

/** ดึง open orders (limit ที่ยังไม่ fill) — filter symbol ฝั่ง client */
export async function getOpenOrders(
  creds: MexcCredentials,
  symbol?: string,
): Promise<OpenOrderRow[]> {
  const res = await mexcPrivateGet<unknown>(creds, "/api/v1/private/order/list/open_orders", {
    page_num: 1,
    page_size: 100,
  });
  if (!res.success || !Array.isArray(res.data)) return [];
  const sym = symbol?.trim().toUpperCase();
  const out: OpenOrderRow[] = [];
  for (const x of res.data) {
    const row = parseOpenOrderRow(x);
    if (!row) continue;
    if (sym && row.symbol !== sym) continue;
    out.push(row);
  }
  return out;
}

/**
 * ยกเลิก open limit orders ตาม orderId (MEXC `/api/v1/private/order/cancel`, สูงสุด 50 ต่อครั้ง)
 */
export async function cancelOpenOrders(
  creds: MexcCredentials,
  orderIds: string[],
): Promise<{ success: boolean; code?: number; message?: string }> {
  const ids = (orderIds ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  if (ids.length === 0) return { success: true };
  const body = ids.map((id) => ({ orderId: id }));
  const res = await mexcPrivatePost<unknown>(
    creds,
    "/api/v1/private/order/cancel",
    body as unknown as Record<string, unknown>,
  );
  return { success: res.success, code: res.code, message: res.message };
}

/**
 * ยกเลิก plan/trigger order ตาม orderId list (MEXC `/api/v1/private/planorder/cancel`)
 * ไม่ throw — fail แบบ silent (เก็บผลใน return)
 */
export async function cancelPlanOrders(
  creds: MexcCredentials,
  orderIds: string[]
): Promise<{ success: boolean; code?: number; message?: string }> {
  const ids = (orderIds ?? []).filter((s) => typeof s === "string" && s.trim());
  if (ids.length === 0) return { success: true };
  const body: Record<string, unknown>[] = ids.map((id) => ({ orderId: id }));
  const res = await mexcPrivatePost<unknown>(creds, "/api/v1/private/planorder/cancel", body as unknown as Record<string, unknown>);
  return { success: res.success, code: res.code, message: res.message };
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

/**
 * ปิด open position เฉพาะทิศ long/short ของ symbol นี้
 */
export async function closeOpenPositionForSymbolSide(
  creds: MexcCredentials,
  contractSymbol: string,
  side: "long" | "short",
): Promise<{
  success: boolean;
  closed: { positionId: number; orderId?: string; error?: string }[];
  message?: string;
}> {
  const sym = contractSymbol.trim().toUpperCase();
  const wantType = side === "long" ? 1 : 2;
  const positionMode = await getFuturesUserPositionMode(creds);
  const positions = await getOpenPositions(creds, sym);
  const actives = positions.filter(
    (x) =>
      x.state === 1 &&
      x.holdVol > 0 &&
      x.symbol === sym &&
      x.positionType === wantType,
  );
  if (actives.length === 0) {
    return { success: true, closed: [], message: "no_open_position" };
  }
  const mark = await getContractLastPricePublic(sym);
  const markPrice = mark != null && mark > 0 ? mark : 1;
  const closed: { positionId: number; orderId?: string; error?: string }[] = [];
  for (const pos of actives) {
    const r = await createCloseOrder(creds, {
      symbol: sym,
      position: pos,
      markPrice,
      positionMode,
    });
    if (r.success) {
      const d = r.data;
      const oid =
        d && typeof d === "object" && d !== null && "orderId" in d
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

export type MexcHistoricalPositionRow = {
  positionId: number;
  symbol: string;
  /** 1 = long, 2 = short */
  positionType: number;
  /** 1 holding, 2 system-held, 3 closed */
  state: number;
  holdVol?: number;
  closeVol?: number;
  openAvgPrice?: number;
  closeAvgPrice?: number;
  realised?: number;
  closeProfitLoss?: number;
  /** ค่าธรรมเนียมสะสมของ position (ไม่รวม funding) */
  fee?: number;
  totalFee?: number;
  leverage?: number;
  createTime?: number | string;
  updateTime?: number | string;
};

type MexcHistoryPositionsPage = {
  resultList?: unknown[];
  pageSize?: number;
  totalCount?: number;
  totalPage?: number;
  currentPage?: number;
};

function parseMexcHistoricalPositionRow(raw: unknown): MexcHistoricalPositionRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const positionId =
    typeof o.positionId === "number" && Number.isFinite(o.positionId)
      ? o.positionId
      : typeof o.positionId === "string" && /^\d+$/.test(o.positionId)
        ? Number(o.positionId)
        : NaN;
  const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
  const positionType =
    typeof o.positionType === "number" && Number.isFinite(o.positionType) ? o.positionType : NaN;
  const state = typeof o.state === "number" && Number.isFinite(o.state) ? o.state : NaN;
  if (!Number.isFinite(positionId) || !symbol || !Number.isFinite(positionType) || !Number.isFinite(state)) {
    return null;
  }
  const row: MexcHistoricalPositionRow = { positionId, symbol, positionType, state };
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  row.holdVol = num(o.holdVol);
  row.closeVol = num(o.closeVol);
  row.openAvgPrice = num(o.openAvgPrice);
  row.closeAvgPrice = num(o.closeAvgPrice);
  row.realised = num(o.realised);
  row.closeProfitLoss = num(o.closeProfitLoss);
  row.fee = num(o.fee);
  row.totalFee = num(o.totalFee);
  row.leverage = num(o.leverage);
  if (typeof o.createTime === "number" || typeof o.createTime === "string") row.createTime = o.createTime;
  if (typeof o.updateTime === "number" || typeof o.updateTime === "string") row.updateTime = o.updateTime;
  return row;
}

function parseMexcHistoryPositionsPayload(data: unknown): MexcHistoricalPositionRow[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    const out: MexcHistoricalPositionRow[] = [];
    for (const x of data) {
      const row = parseMexcHistoricalPositionRow(x);
      if (row) out.push(row);
    }
    return out;
  }
  if (typeof data === "object" && data !== null && "resultList" in data) {
    const list = (data as MexcHistoryPositionsPage).resultList;
    if (!Array.isArray(list)) return [];
    const out: MexcHistoricalPositionRow[] = [];
    for (const x of list) {
      const row = parseMexcHistoricalPositionRow(x);
      if (row) out.push(row);
    }
    return out;
  }
  return [];
}

/** ดึงประวัติ position ที่ปิดแล้ว — paginate จนครบหรือถึง maxPages */
export async function fetchHistoricalPositions(
  creds: MexcCredentials,
  opts?: {
    symbol?: string;
    positionType?: 1 | 2;
    startTimeMs?: number;
    endTimeMs?: number;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<{ ok: true; rows: MexcHistoricalPositionRow[] } | { ok: false; code?: number; message: string }> {
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(opts?.maxPages ?? 5, 1), 20);
  const out: MexcHistoricalPositionRow[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const query: Record<string, string | number | undefined> = {
      page_num: page,
      page_size: pageSize,
    };
    if (opts?.symbol?.trim()) query.symbol = opts.symbol.trim().toUpperCase();
    if (opts?.positionType === 1 || opts?.positionType === 2) query.position_type = opts.positionType;
    if (opts?.startTimeMs != null && Number.isFinite(opts.startTimeMs)) query.start_time = Math.floor(opts.startTimeMs);
    if (opts?.endTimeMs != null && Number.isFinite(opts.endTimeMs)) query.end_time = Math.floor(opts.endTimeMs);

    const res = await mexcPrivateGet<unknown>(
      creds,
      "/api/v1/private/position/list/history_positions",
      query,
    );
    if (!res.success) {
      return {
        ok: false,
        code: res.code,
        message:
          typeof res.message === "string" && res.message.trim() ? res.message.trim() : `code ${res.code}`,
      };
    }

    const pageRows = parseMexcHistoryPositionsPayload(res.data);
    out.push(...pageRows);

    if (pageRows.length < pageSize) break;
    if (typeof res.data === "object" && res.data !== null && !Array.isArray(res.data)) {
      const p = res.data as MexcHistoryPositionsPage;
      if (typeof p.totalPage === "number" && page >= p.totalPage) break;
      if (typeof p.currentPage === "number" && typeof p.totalPage === "number" && p.currentPage >= p.totalPage) {
        break;
      }
    }
  }

  return { ok: true, rows: out };
}
