import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbolFromTradingView } from "@/src/coinMap";
import { closeAllOpenForSymbol, createOpenMarketOrder } from "@/src/mexcFuturesClient";
import { getTradingViewMexcSettings, verifyUserWebhookToken } from "@/src/tradingViewCloseSettingsStore";
import { normalizeTradingViewUserId } from "@/src/tradingViewWebhookUserId";
import { isTvWebhookNonceUsed, markTvWebhookNonceUsed } from "@/src/tradingViewWebhookNonceStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseOpenSide(raw: unknown): { long: boolean } | null {
  if (typeof raw === "number" && raw === 1) return { long: true };
  if (typeof raw === "number" && raw === 3) return { long: false };
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "LONG" || s === "L") return { long: true };
  if (s === "SHORT" || s === "S") return { long: false };
  return null;
}

function parsePositiveNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function parseWebhookNonce(body: Record<string, unknown>): string | undefined {
  const raw = body.nonce;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 200);
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw).slice(0, 200);
  return undefined;
}

/**
 * TradingView Alert → POST JSON (URL เดิม)
 * CLOSE: cmd CLOSE_POSITION
 * OPEN: cmd OPEN_POSITION + side (LONG|SHORT|1|3) + marginUsdt + leverage (+ optional notionalUsdt+leverage)
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const id = body.id;
  const token = body.token;
  const symbolRaw = body.symbol;
  const cmd = typeof body.cmd === "string" ? body.cmd.trim().toUpperCase() : "";

  if (cmd !== "CLOSE_POSITION" && cmd !== "OPEN_POSITION") {
    return NextResponse.json({ ok: false, error: "unsupported_cmd" }, { status: 400 });
  }
  if (typeof id !== "string" && typeof id !== "number") {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
  }
  if (typeof symbolRaw !== "string" || !symbolRaw.trim()) {
    return NextResponse.json({ ok: false, error: "symbol_required" }, { status: 400 });
  }

  const userId = normalizeTradingViewUserId(id);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "id_invalid" }, { status: 400 });
  }

  const okToken = await verifyUserWebhookToken(userId, token.trim());
  if (!okToken) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const settings = await getTradingViewMexcSettings(userId);
  if (!settings?.mexcApiKey || !settings.mexcSecret) {
    return NextResponse.json(
      { ok: false, error: "mexc_creds_not_configured" },
      { status: 503 }
    );
  }

  const nonce = parseWebhookNonce(body);
  if (nonce && (await isTvWebhookNonceUsed(userId, nonce))) {
    return NextResponse.json(
      {
        ok: false,
        error: "duplicate_nonce",
        message:
          "nonce นี้ใช้แล้ว — สร้าง JSON ใหม่จากบอท/Settings หรือใน TradingView ตั้ง nonce เป็น {{timenow}} เพื่อให้แต่ละครั้งไม่ซ้ำ",
      },
      { status: 409 }
    );
  }

  const resolved = normalizeSymbolFromTradingView(symbolRaw.trim());
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "symbol_unknown" }, { status: 400 });
  }

  const creds = { apiKey: settings.mexcApiKey, secret: settings.mexcSecret };
  const priceNote =
    body.price === undefined || body.price === null
      ? null
      : String(body.price);
  const remark = typeof body.remark === "string" ? body.remark : undefined;

  if (cmd === "CLOSE_POSITION") {
    try {
      const r = await closeAllOpenForSymbol(creds, resolved.contractSymbol);
      if (!r.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "close_failed",
            message: r.message,
            details: r.closed,
            contractSymbol: resolved.contractSymbol,
            price: priceNote,
            remark,
          },
          { status: 502 }
        );
      }
      if (r.message === "no_open_position") {
        if (nonce) await markTvWebhookNonceUsed(userId, nonce);
        return NextResponse.json(
          {
            ok: true,
            skipped: true,
            message: "no_open_position",
            contractSymbol: resolved.contractSymbol,
            price: priceNote,
            remark,
          },
          { status: 200 }
        );
      }
      if (nonce) await markTvWebhookNonceUsed(userId, nonce);
      return NextResponse.json(
        {
          ok: true,
          cmd: "CLOSE_POSITION",
          contractSymbol: resolved.contractSymbol,
          label: resolved.label,
          closed: r.closed,
          price: priceNote,
          remark,
        },
        { status: 200 }
      );
    } catch (e) {
      console.error("[webhooks/tv/close]", e);
      return NextResponse.json(
        { ok: false, error: "mexc_error", message: e instanceof Error ? e.message : String(e) },
        { status: 502 }
      );
    }
  }

  // OPEN_POSITION
  const sideParsed = parseOpenSide(body.side);
  if (!sideParsed) {
    return NextResponse.json(
      { ok: false, error: "open_side_invalid", hint: "side ต้องเป็น LONG หรือ SHORT (หรือ 1 / 3)" },
      { status: 400 }
    );
  }
  const marginUsdt =
    parsePositiveNumber(body.marginUsdt) ?? parsePositiveNumber(body.margin_usdt);
  const notionalUsdt = parsePositiveNumber(body.notionalUsdt) ?? parsePositiveNumber(body.notional_usdt);
  const leverage =
    typeof body.leverage === "number"
      ? body.leverage
      : typeof body.leverage === "string"
        ? Number(body.leverage)
        : NaN;

  let margin = marginUsdt;
  let lev = leverage;
  if (margin == null && notionalUsdt != null && Number.isFinite(lev) && lev > 0) {
    margin = notionalUsdt / lev;
  }
  if (margin == null || !Number.isFinite(lev) || lev < 1) {
    return NextResponse.json(
      {
        ok: false,
        error: "open_params_invalid",
        hint: "ต้องมี marginUsdt + leverage หรือ notionalUsdt + leverage",
      },
      { status: 400 }
    );
  }

  const openTypeRaw = body.openType ?? body.open_type;
  let openType: 1 | 2 | undefined;
  if (openTypeRaw === 1 || openTypeRaw === 2) {
    openType = openTypeRaw as 1 | 2;
  } else if (typeof openTypeRaw === "string") {
    const o = Number(openTypeRaw);
    if (o === 1 || o === 2) openType = o as 1 | 2;
  }

  try {
    const r = await createOpenMarketOrder(creds, {
      contractSymbol: resolved.contractSymbol,
      long: sideParsed.long,
      marginUsdt: margin,
      leverage: lev,
      openType,
    });
    if (!r.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "open_failed",
          code: r.code,
          message: r.message ?? `code ${r.code}`,
          contractSymbol: resolved.contractSymbol,
          price: priceNote,
          remark,
        },
        { status: 502 }
      );
    }
    const d = r.data;
    const orderId =
      d && typeof d === "object" && d !== null && "orderId" in d
        ? String((d as { orderId: unknown }).orderId)
        : undefined;
    if (nonce) await markTvWebhookNonceUsed(userId, nonce);
    return NextResponse.json(
      {
        ok: true,
        cmd: "OPEN_POSITION",
        contractSymbol: resolved.contractSymbol,
        label: resolved.label,
        orderId,
        price: priceNote,
        remark,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("[webhooks/tv/close] open", e);
    return NextResponse.json(
      { ok: false, error: "mexc_error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
