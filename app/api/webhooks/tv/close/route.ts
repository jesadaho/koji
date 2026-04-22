import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbolFromTradingView } from "@/src/coinMap";
import { closeAllOpenForSymbol } from "@/src/mexcFuturesClient";
import { getTradingViewMexcSettings, verifyUserWebhookToken } from "@/src/tradingViewCloseSettingsStore";
import { normalizeTradingViewUserId } from "@/src/tradingViewWebhookUserId";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TradingView Alert → Webhook URL: POST JSON
 * { "id", "token", "symbol", "price"?, "cmd": "CLOSE_POSITION", "remark"? }
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

  if (cmd !== "CLOSE_POSITION") {
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
    return NextResponse.json(
      {
        ok: true,
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
