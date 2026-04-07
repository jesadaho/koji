import { Client } from "@line/bot-sdk";
import type { MessageEvent, WebhookEvent } from "@line/bot-sdk";
import { resolveContractSymbol } from "./coinMap";
import { addAlert, listAlertsForUser, removeAlertByIndex } from "./alertsStore";
import { fetchSimplePrices, formatSignal } from "./cryptoService";
import { config } from "./config";
import { buildKojiWelcomeFlexContents, KOJI_MENU_ALT_TEXT } from "./lineFlexKojiMenu";

export function createLineClient(channelAccessToken: string) {
  return new Client({ channelAccessToken });
}

function textOf(e: MessageEvent): string | null {
  if (e.message.type !== "text") return null;
  return e.message.text.trim();
}

const HELP = `Koji — แจ้งเตือนราคา (MEXC Futures USDT)

คำสั่ง:
• ราคา <เหรียญ> — ราคา last บนสัญญา + %24h
  ตัวอย่าง: ราคา btc
  (พิมพ์สัญญาเต็มได้ เช่น BTC_USDT)

• เตือน <เหรียญ> เกิน <ราคา> — แจ้งเมื่อราคา ≥ เป้า (USDT)
• เตือน <เหรียญ> ต่ำกว่า <ราคา> — แจ้งเมื่อราคา ≤ เป้า
  ตัวอย่าง: เตือน eth เกิน 4000

• รายการเตือน — ดูการแจ้งเตือนที่ตั้งไว้
• ลบเตือน <ลำดับ> — ลบตามเลขในรายการ
  ตัวอย่าง: ลบเตือน 1

(ภาษาอังกฤษ: price btc, alert btc above 100000, alerts, unalert 1)

จัดการผ่านเว็บ LIFF บน Next.js (เช่น Vercel) — ตั้ง LIFF Endpoint ให้ตรง URL โฮสต์หน้าเว็บ`;

function parsePriceCmd(t: string): string | null {
  const m = t.match(/^(?:ราคา|price)\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function parseAlertCmd(t: string): {
  symbol: string;
  direction: "above" | "below";
  target: number;
} | null {
  let m = t.match(
    /^(?:เตือน|alert)\s+(\S+)\s+(?:เกิน|ขึ้น|above|>=|>)\s*([\d_,.]+)\s*$/i
  );
  if (m) {
    const target = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(target)) return null;
    return { symbol: m[1]!, direction: "above", target };
  }
  m = t.match(
    /^(?:เตือน|alert)\s+(\S+)\s+(?:ต่ำกว่า|ลง|below|<=|<)\s*([\d_,.]+)\s*$/i
  );
  if (m) {
    const target = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(target)) return null;
    return { symbol: m[1]!, direction: "below", target };
  }
  return null;
}

function parseUnalert(t: string): number | null {
  const m = t.match(/^(?:ลบเตือน|unalert|delalert)\s+(\d+)\s*$/i);
  if (!m) return null;
  return Number(m[1]);
}

function isKojiMenuTrigger(text: string): boolean {
  const t = text.trim();
  if (t === "โคจิ") return true;
  return /^koji$/i.test(t);
}

export async function handleWebhookEvent(client: Client, event: WebhookEvent): Promise<void> {
  if (event.mode === "standby") return;

  if (event.type === "follow") {
    const uid = event.source.type === "user" ? event.source.userId : undefined;
    if (uid) {
      await client.replyMessage(event.replyToken, [
        { type: "text", text: `สวัสดีครับ ผม Koji\n\n${HELP}` },
      ]);
    }
    return;
  }

  if (event.type !== "message" || event.source.type !== "user") return;
  const uid = event.source.userId;
  if (!uid) return;

  const msgEvent = event as MessageEvent;
  const text = textOf(msgEvent);
  if (!text) return;

  const lower = text.toLowerCase();
  if (lower === "help" || lower === "ช่วยเหลือ" || lower === "?") {
    await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: HELP }]);
    return;
  }

  if (isKojiMenuTrigger(text)) {
    await client.replyMessage(msgEvent.replyToken, [
      {
        type: "flex",
        altText: KOJI_MENU_ALT_TEXT,
        contents: buildKojiWelcomeFlexContents(config.liffId),
      },
    ]);
    return;
  }

  if (/^(?:รายการเตือน|alerts?)\s*$/i.test(text)) {
    const list = await listAlertsForUser(uid);
    if (list.length === 0) {
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: "ยังไม่มีการแจ้งเตือน" }]);
      return;
    }
    const body = list
      .map(
        (a, i) =>
          `${i + 1}. ${a.coinId} ${a.direction === "above" ? "≥" : "≤"} ${a.targetUsd} USDT`
      )
      .join("\n");
    await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: `การแจ้งเตือน:\n${body}` }]);
    return;
  }

  const unIdx = parseUnalert(text);
  if (unIdx !== null) {
    const ok = await removeAlertByIndex(uid, unIdx);
    await client.replyMessage(msgEvent.replyToken, [
      { type: "text", text: ok ? "ลบการแจ้งเตือนแล้ว" : "ไม่พบลำดับนี้" },
    ]);
    return;
  }

  const sym = parsePriceCmd(text);
  if (sym) {
    const resolved = resolveContractSymbol(sym);
    if (!resolved) {
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: "ไม่รู้จักคู่นี้ ลองเช่น btc, eth หรือพิมพ์สัญญา MEXC เช่น BTC_USDT" },
      ]);
      return;
    }
    try {
      const prices = await fetchSimplePrices([resolved.contractSymbol]);
      const q = prices[resolved.contractSymbol];
      if (!q) {
        await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: "ดึงราคาไม่สำเร็จ ลองใหม่ภายหลัง" }]);
        return;
      }
      const sig = formatSignal(q.usd_24h_change);
      const msg = `${resolved.contractSymbol}\nราคา ~ ${q.usd.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT\n${sig}`;
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: msg }]);
    } catch {
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: "ดึงราคา MEXC ไม่สำเร็จ (เครือข่าย / สัญญาไม่มีบน MEXC)" },
      ]);
    }
    return;
  }

  const alert = parseAlertCmd(text);
  if (alert) {
    const resolved = resolveContractSymbol(alert.symbol);
    if (!resolved) {
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: "ไม่รู้จักคู่นี้ (ลอง btc หรือ BTC_USDT)" }]);
      return;
    }
    await addAlert({
      userId: uid,
      coinId: resolved.contractSymbol,
      symbolLabel: resolved.label,
      direction: alert.direction,
      targetUsd: alert.target,
    });
    const cond = alert.direction === "above" ? "≥" : "≤";
    await client.replyMessage(msgEvent.replyToken, [
      { type: "text", text: `ตั้งแจ้งเตือน ${resolved.contractSymbol} ${cond} ${alert.target} USDT แล้ว` },
    ]);
    return;
  }

  await client.replyMessage(msgEvent.replyToken, [
    { type: "text", text: 'ไม่เข้าใจคำสั่ง พิมพ์ "ช่วยเหลือ"' },
  ]);
}
