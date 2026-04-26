import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbolFromTradingView } from "@/src/coinMap";
import { closeAllOpenForSymbol, createOpenMarketOrder } from "@/src/mexcFuturesClient";
import { getTradingViewMexcSettings, verifyUserWebhookToken } from "@/src/tradingViewCloseSettingsStore";
import { normalizeTradingViewUserId } from "@/src/tradingViewWebhookUserId";
import { isTvWebhookNonceUsed, markTvWebhookNonceUsed } from "@/src/tradingViewWebhookNonceStore";
import {
  notifyTvWebhookCloseNoOpen,
  notifyTvWebhookCloseOk,
  notifyTvWebhookError,
  notifyTvWebhookMalformedBodyRaw,
  notifyTvWebhookOpenOk,
} from "@/src/tradingViewWebhookTelegramNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TV_WH_LOG = "[webhooks/tv]";

type TvWhLog = {
  status: number;
  result: string;
  userId?: string;
  cmd?: string;
  symbolIn?: string;
  label?: string;
  contract?: string;
  message?: string;
  detail?: unknown;
};

function logTvWebhook(entry: TvWhLog): void {
  const { status, result, ...rest } = entry;
  const line = { result, status, ...rest };
  if (status >= 400) {
    console.error(TV_WH_LOG, line);
  } else {
    console.info(TV_WH_LOG, line);
  }
}

/** ตัด preview ล็อก + บัง token ใน JSON text */
function logSafeWebhookBodyPreview(raw: string, max = 200): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "(empty)";
  return t
    .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"(redacted)"')
    .slice(0, max);
}

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
  const contentType = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  let body: Record<string, unknown>;
  try {
    if (!raw.trim()) {
      logTvWebhook({
        status: 400,
        result: "empty_body",
        message: "body ว่าง — ตั้ง Webhook message ใน TradingView ให้เป็นข้อความ JSON ไม่ใช่ค่า default",
        detail: { contentType, bodyLength: 0 },
      });
      await notifyTvWebhookMalformedBodyRaw(raw, "empty_body", [
        "body ว่าง — ใส่ Message เป็น JSON ใน TradingView alert",
        `Content-Type: ${contentType || "(ไม่มี)"}`,
      ]);
      return NextResponse.json(
        {
          ok: false,
          error: "empty_body",
          hint: "Alert → Webhook URL ต้องใส่ Message เป็น JSON (body ต้องไม่ว่าง)",
        },
        { status: 400 }
      );
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logTvWebhook({
      status: 400,
      result: "invalid_json",
      message: msg,
      detail: {
        contentType: contentType || "(no Content-Type)",
        bodyLength: raw.length,
        preview: logSafeWebhookBodyPreview(raw, 300),
      },
    });
    await notifyTvWebhookMalformedBodyRaw(raw, "invalid_json", [
      `parse: ${msg.slice(0, 200)}`,
      `preview: ${logSafeWebhookBodyPreview(raw, 400)}`,
    ]);
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_json",
        hint: "Message ต้องเป็น JSON สมบูรณ์ — ตรวจเครื่องหมาย , \" {{ }} ใน TradingView; ลอง Test ใน bar แอลเทิร์ต",
      },
      { status: 400 }
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    logTvWebhook({
      status: 400,
      result: "invalid_json",
      message: "JSON ต้องเป็น object ที่ราก",
      detail: { preview: logSafeWebhookBodyPreview(raw, 200) },
    });
    await notifyTvWebhookMalformedBodyRaw(raw, "invalid_json_not_object", [
      "ราก JSON ต้องเป็น { … } ไม่ใช่ [ ] หรือตัวเลขอย่างเดียว",
      `preview: ${logSafeWebhookBodyPreview(raw, 400)}`,
    ]);
    return NextResponse.json(
      { ok: false, error: "invalid_json", hint: "Message ต้องเป็น { ... } ไม่ใช่ [ ] หรือตัวเลข" },
      { status: 400 }
    );
  }

  const id = body.id;
  const token = body.token;
  const symbolRaw = body.symbol;
  const cmd = typeof body.cmd === "string" ? body.cmd.trim().toUpperCase() : "";

  if (cmd !== "CLOSE_POSITION" && cmd !== "OPEN_POSITION") {
    logTvWebhook({ status: 400, result: "unsupported_cmd", cmd: cmd || "(empty)", message: "cmd must be CLOSE_POSITION or OPEN_POSITION" });
    return NextResponse.json({ ok: false, error: "unsupported_cmd" }, { status: 400 });
  }
  if (typeof id !== "string" && typeof id !== "number") {
    logTvWebhook({ status: 400, result: "id_required", cmd });
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }
  if (typeof token !== "string" || !token.trim()) {
    logTvWebhook({ status: 400, result: "token_required", cmd });
    return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
  }
  if (typeof symbolRaw !== "string" || !symbolRaw.trim()) {
    logTvWebhook({ status: 400, result: "symbol_required", cmd });
    return NextResponse.json({ ok: false, error: "symbol_required" }, { status: 400 });
  }

  const userId = normalizeTradingViewUserId(id);
  if (!userId) {
    logTvWebhook({ status: 400, result: "id_invalid", cmd, message: "id ต้องเป็นตัวเลขหรือ tg:<ตัวเลข>" });
    return NextResponse.json({ ok: false, error: "id_invalid" }, { status: 400 });
  }

  const okToken = await verifyUserWebhookToken(userId, token.trim());
  if (!okToken) {
    logTvWebhook({ status: 401, result: "unauthorized", userId, cmd });
    await notifyTvWebhookError(userId, "unauthorized", [
      "Token ไม่ตรงกับที่บันทึก",
      "ขอ Webhook JSON ใหม่จากบอทหรือ Mini App แล้วอัปเดต alert",
    ]);
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const settings = await getTradingViewMexcSettings(userId);
  if (!settings?.mexcApiKey || !settings.mexcSecret) {
    logTvWebhook({ status: 503, result: "mexc_creds_not_configured", userId, cmd });
    await notifyTvWebhookError(userId, "mexc_creds_not_configured", [
      "ยังไม่ได้กรอก MEXC API Key/Secret ใน Settings (Mini App)",
    ]);
    return NextResponse.json(
      { ok: false, error: "mexc_creds_not_configured" },
      { status: 503 }
    );
  }

  const nonce = parseWebhookNonce(body);
  if (nonce && (await isTvWebhookNonceUsed(userId, nonce))) {
    logTvWebhook({ status: 409, result: "duplicate_nonce", userId, cmd, message: "nonce ซ้ำ" });
    await notifyTvWebhookError(userId, "duplicate_nonce", [
      "ค่า nonce นี้ใช้ไปแล้ว (ส่งซ้ำ)",
      "สร้าง JSON ใหม่ หรือตั้ง \"nonce\": \"{{timenow}}\" ใน TradingView",
    ]);
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
    const sym = symbolRaw.trim().slice(0, 80);
    logTvWebhook({ status: 400, result: "symbol_unknown", userId, cmd, symbolIn: sym });
    await notifyTvWebhookError(userId, "symbol_unknown", [`symbol ไม่รู้จัก: ${sym}`, "ตรวจสอบ {{ticker}} ใน alert กับ coin map ของ Koji"]);
    return NextResponse.json({ ok: false, error: "symbol_unknown" }, { status: 400 });
  }

  const creds = { apiKey: settings.mexcApiKey, secret: settings.mexcSecret };
  const priceNote =
    body.price === undefined || body.price === null
      ? null
      : String(body.price);
  const remark = typeof body.remark === "string" ? body.remark : undefined;

  console.info(TV_WH_LOG, {
    result: "request_ok",
    userId,
    cmd,
    label: resolved.label,
    contract: resolved.contractSymbol,
    symbolIn: String(symbolRaw).trim().slice(0, 80),
    hasNonce: Boolean(nonce),
  });

  if (cmd === "CLOSE_POSITION") {
    try {
      const r = await closeAllOpenForSymbol(creds, resolved.contractSymbol);
      if (!r.success) {
        logTvWebhook({
          status: 502,
          result: "close_failed",
          userId,
          cmd: "CLOSE_POSITION",
          label: resolved.label,
          contract: resolved.contractSymbol,
          message: r.message,
          detail: r.closed,
        });
        const closeErrLines = [
          `คำสั่ง: ปิด position`,
          `${resolved.label} · ${resolved.contractSymbol}`,
          r.message ? `สาเหตุ: ${r.message}` : "",
          r.closed?.length
            ? `รายละเอียด: ${JSON.stringify(r.closed).slice(0, 800)}`
            : "",
        ].filter(Boolean) as string[];
        await notifyTvWebhookError(userId, "close_failed", closeErrLines);
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
        logTvWebhook({
          status: 200,
          result: "close_no_open_position",
          userId,
          cmd: "CLOSE_POSITION",
          label: resolved.label,
          contract: resolved.contractSymbol,
        });
        await notifyTvWebhookCloseNoOpen({
          userId,
          label: resolved.label,
          contractSymbol: resolved.contractSymbol,
          priceNote,
          remark,
        });
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
      logTvWebhook({
        status: 200,
        result: "close_ok",
        userId,
        cmd: "CLOSE_POSITION",
        label: resolved.label,
        contract: resolved.contractSymbol,
        detail: r.closed,
      });
      await notifyTvWebhookCloseOk({
        userId,
        label: resolved.label,
        contractSymbol: resolved.contractSymbol,
        closed: r.closed,
        priceNote,
        remark,
      });
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
      const em = e instanceof Error ? e.message : String(e);
      logTvWebhook({
        status: 502,
        result: "close_mexc_error",
        userId,
        cmd: "CLOSE_POSITION",
        contract: resolved.contractSymbol,
        message: em,
        detail: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
      });
      console.error(TV_WH_LOG, "close exception", e);
      await notifyTvWebhookError(userId, "close_mexc_error", [
        "คำสั่ง: ปิด position",
        `${resolved.label} · ${resolved.contractSymbol}`,
        `ข้อผิดพลาด: ${em}`,
      ]);
      return NextResponse.json(
        { ok: false, error: "mexc_error", message: e instanceof Error ? e.message : String(e) },
        { status: 502 }
      );
    }
  }

  // OPEN_POSITION
  const sideParsed = parseOpenSide(body.side);
  if (!sideParsed) {
    logTvWebhook({
      status: 400,
      result: "open_side_invalid",
      userId,
      cmd: "OPEN_POSITION",
      contract: resolved.contractSymbol,
      message: "side ต้อง LONG/SHORT/1/3",
    });
    const sideRaw =
      body.side === undefined
        ? "(ไม่ระบุ)"
        : String(body.side).slice(0, 40);
    await notifyTvWebhookError(userId, "open_side_invalid", [
      "คำสั่ง: เปิด position",
      `${resolved.label} · ${resolved.contractSymbol}`,
      `side ใน JSON: ${sideRaw}`,
      "ต้องเป็น LONG / SHORT / 1 (long) / 3 (short)",
    ]);
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
    logTvWebhook({
      status: 400,
      result: "open_params_invalid",
      userId,
      cmd: "OPEN_POSITION",
      contract: resolved.contractSymbol,
    });
    await notifyTvWebhookError(userId, "open_params_invalid", [
      "คำสั่ง: เปิด position",
      `${resolved.label} · ${resolved.contractSymbol}`,
      "ต้องมี marginUsdt + leverage (หรือ notionalUsdt + leverage) ที่ถูกต้อง",
    ]);
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
      const om = r.message ?? `code ${r.code}`;
      logTvWebhook({
        status: 502,
        result: "open_failed",
        userId,
        cmd: "OPEN_POSITION",
        label: resolved.label,
        contract: resolved.contractSymbol,
        message: om,
        detail: r.code,
      });
      await notifyTvWebhookError(userId, "open_failed", [
        "คำสั่ง: เปิด position",
        `${resolved.label} · ${resolved.contractSymbol}`,
        `MEXC: ${om}`,
      ]);
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
    logTvWebhook({
      status: 200,
      result: "open_ok",
      userId,
      cmd: "OPEN_POSITION",
      label: resolved.label,
      contract: resolved.contractSymbol,
      message: `side=${sideParsed.long ? "long" : "short"} orderId=${orderId ?? "-"}`,
    });
    await notifyTvWebhookOpenOk({
      userId,
      label: resolved.label,
      contractSymbol: resolved.contractSymbol,
      long: sideParsed.long,
      marginUsdt: margin,
      leverage: lev,
      orderId,
      priceNote,
      remark,
    });
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
    const em = e instanceof Error ? e.message : String(e);
    logTvWebhook({
      status: 502,
      result: "open_mexc_error",
      userId,
      cmd: "OPEN_POSITION",
      contract: resolved.contractSymbol,
      message: em,
      detail: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
    });
    console.error(TV_WH_LOG, "open exception", e);
    await notifyTvWebhookError(userId, "open_mexc_error", [
      "คำสั่ง: เปิด position",
      `${resolved.label} · ${resolved.contractSymbol}`,
      `ข้อผิดพลาด: ${em}`,
    ]);
    return NextResponse.json(
      { ok: false, error: "mexc_error", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
