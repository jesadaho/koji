import { Client } from "@line/bot-sdk";
import type { MessageEvent, WebhookEvent } from "@line/bot-sdk";
import { resolveContractSymbol } from "./coinMap";
import { addAlert, listAlertsForUser, removeAlertByIndex } from "./alertsStore";
import {
  addPctStepAlert,
  listPctStepAlertsForUser,
  removePctStepAlertByIndex,
} from "./pctStepAlertsStore";
import { fetchSimplePrices, formatSignal } from "./cryptoService";
import { config } from "./config";
import {
  buildKojiWelcomeFlexContents,
  KOJI_MENU_ALT_TEXT,
  KOJI_MENU_ALT_TEXT_NO_TOP_FUNDING,
} from "./lineFlexKojiMenu";
import { isCronStatusQuery } from "./cronLineCommands";
import { isMarketPulseStatusQuery } from "./marketPulseLineCommands";
import {
  isSparkMatrixResetAllowed,
  isSparkMatrixResetCommand,
  isSparkStatsQuery,
} from "./sparkFollowUpLineCommands";
import { formatSparkStatsMessage } from "./sparkFollowUpStats";
import { getMarketPulseStatusMessage } from "./marketPulseTick";
import {
  isSystemSubscribeStatusQuery,
  parseSystemChangeSubscribeCommand,
} from "./systemChangeLineCommands";
import { formatCronStatusForLine, loadCronStatusBundle } from "./cronStatusStore";
import {
  addSystemChangeSubscriber,
  hasSystemChangeSubscriber,
  removeSystemChangeSubscriber,
} from "./systemChangeSubscribersStore";
import { sendAlertNotification } from "./alertNotify";
import { parsePositionChecklist } from "./positionChecklistLineCommands";
import { buildPositionChecklistMessage } from "./positionChecklistService";
import { resetSparkFollowUpState } from "./sparkFollowUpStore";

export function createLineClient(channelAccessToken: string) {
  return new Client({ channelAccessToken });
}

/** เมื่อไม่มี LINE_CHANNEL_ACCESS_TOKEN (โหมด Telegram-only) ใช้ placeholder — อย่าเรียก LINE API จริง */
export function createLineClientForCron(): Client {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  return createLineClient(t || "__LINE_CHANNEL_ACCESS_TOKEN_DISABLED__");
}

function textOf(e: MessageEvent): string | null {
  if (e.message.type !== "text") return null;
  return e.message.text.trim();
}

/** userId ของคนส่งข้อความ — รองรับแชท 1:1 และกลุ่ม/ห้อง (แตะปุ่ม Flex ในกลุ่มจะได้ source แบบ group/room) */
function messageEventUserId(event: MessageEvent): string | undefined {
  const s = event.source;
  if (s.type === "user") return s.userId;
  if (s.type === "group" || s.type === "room") return s.userId;
  return undefined;
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

• เตือน% <เหรียญ> <ขั้น%> — แจ้งเตือนการเคลื่อนไหวราคา (รายวัน 07:00 ไทย) เมื่อครบทุกขั้น%
• เตือน% <เหรียญ> <ขั้น%> trailing — แจ้งเตือนการเคลื่อนไหวราคา แบบ trailing (หลังแจ้งเลื่อน anchor)
• รายการเตือน% — ดูรายการแจ้งเตือนการเคลื่อนไหวราคา
• ลบเตือน% <ลำดับ>
  ตัวอย่าง: เตือน% btc 2 · เตือน% eth 1.5 trailing · ลบเตือน% 1
  (EN: pctalert btc 2, pct alerts, unpct 1)

(ภาษาอังกฤษ: price btc, alert btc above 100000, alerts, unalert 1)

• ติดตามระบบ — System conditions: funding / max order size (Top 50 |funding|)
  funding: แจ้งเมื่อรอบชำระ (ชม.) เปลี่ยน หรือ |Δfunding| ≥ 0.1% pt — ไม่แจ้งเมื่อมีแค่เวลาตัดถัดไปเปลี่ยน (ปรับ env CONTRACT_FUNDING_MIN_DELTA_DISPLAY ได้)
  order: แจ้งเมื่อ max order size เปลี่ยน
  (หรือเปิด/ปิดจาก LIFF หน้า Settings เมื่อตั้ง LIFF แล้ว)
• เลิกติดตามระบบ — ปิดการแจ้งเตือนดังกล่าว
• สถานะติดตามระบบ — เช็คว่าเปิดรับหรือยัง
  (EN: follow system / unfollow system, system conditions on / off, system status, #subscribeSystem / #unsubscribeSystem / #systemStatus)

• สถานะ sentiment — สรุป Fear & Greed, BTC dominance, Vol ~24h, Sentiment (ข้อมูลล่าสุดจาก API)
  (EN: sentiment, market pulse, #marketPulse)

• สถานะ cron — บันทึกรอบล่าสุด: pct-trailing ~5 นาที (เตือน% + Spark ticker + follow-up) · price-sync ~15 นาที (เป้าราคา + เตือน% รายวัน + volume/RSI + EMA6/12·15m + spot–perp basis) · ชั่วโมง (สัญญา / funding)
  (EN: cron status, #cronStatus — Spark ticker: สถานะ spark, spark cron, #sparkCron)

• สถิติ spark — สรุปผลติดตาม Spark หลัง T+30m … T+4h (momentum vs fade) ในแชท
  เปิด LIFF หน้า «สถิติ Spark» เพื่อดู Win-rate matrix แยก Vol / มาร์ก. (พร็อกซี)
  (EN: spark stats, #sparkStats)

• ล้างสถิติ spark — ล้างข้อมูล matrix (pending / history / fire log) เพื่อเก็บใหม่ — ต้องตั้ง env SPARK_MATRIX_RESET_ALLOWED_USER_IDS=LINE_user_id ของคุณ
  (EN: reset spark matrix, cleanup spark matrix, #sparkreset)

• ไอดีไลน์ — แสดง LINE user id ของคุณ (ใช้ใส่ env เช่น SPARK_MATRIX_RESET_ALLOWED_USER_IDS) — เฉพาะแชท 1:1 กับบอท
  (EN: line id, my line id, #lineid)

• เช็คลิสต์เปิด position — short/long + เหรียญ + Koji Score (weekend / New High / สภาพคล่อง / F&G / basis / EMA6·12 บน 15m)
  ตัวอย่าง: short btc · long eth · ชอต btc 5x
  (EN: short btc, long eth)

• ทดสอบแจ้งเตือน — ส่งไป Telegram / Discord / LINE ตาม env (LINE ต้อง LINE_ALERT_PUSH_ENABLED=1) แล้วตอบยืนยันในแชท
  (EN: test push, #testpush)

• เหรียญที่ติดตามใน LIFF — แจ้งเมื่อ EMA6 กับ EMA12 ตัดกันบน 15 นาที (รอบเดียวกับ price-sync ~15 นาที; ปิดได้ EMA612_15M_WATCH_ALERTS_ENABLED=0)

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

function parseUnpctCmd(t: string): number | null {
  const m = t.match(/^(?:ลบเตือน%|unpct|delpct)\s+(\d+)\s*$/i);
  if (!m) return null;
  return Number(m[1]);
}

function parsePctAlertCmd(t: string): {
  symbol: string;
  stepPct: number;
  mode: "daily_07_bkk" | "trailing";
} | null {
  const s = t.trim();
  const m =
    s.match(/^(?:เตือน%|pctalert)\s+(\S+)\s+([\d.,]+)\s*(trailing)?\s*$/i) ||
    s.match(/^เตือน\s*%\s+(\S+)\s+([\d.,]+)\s*(trailing)?\s*$/i);
  if (!m) return null;
  const stepPct = Number(m[2]!.replace(/,/g, ""));
  if (!Number.isFinite(stepPct) || stepPct <= 0 || stepPct > 100) return null;
  return {
    symbol: m[1]!,
    stepPct,
    mode: m[3]?.toLowerCase() === "trailing" ? "trailing" : "daily_07_bkk",
  };
}

function isPctAlertsListQuery(text: string): boolean {
  const l = text.trim().toLowerCase();
  return l === "รายการเตือน%" || l === "pct alerts" || l === "pctalerts";
}

function isKojiMenuTrigger(text: string): boolean {
  const t = text.trim();
  if (t === "โคจิ") return true;
  return /^koji$/i.test(t);
}

/** ดู LINE user id ของตัวเอง — ตอบได้เฉพาะแชท 1:1 (ไม่ส่งในกลุ่ม) */
function isLineUserIdQuery(t: string): boolean {
  const s = t.trim().toLowerCase();
  if (s === "ไอดี" || s === "ไอดีไลน์" || s === "line id" || s === "my line id") return true;
  return /^#lineid$/i.test(t.trim());
}

/** ทดสอบช่องแจ้งเตือน (Telegram / Discord / LINE) จากแชท */
function isWebhookPushTestQuery(t: string): boolean {
  const s = t.trim().toLowerCase();
  if (s === "#testpush" || s === "test push") return true;
  if (/^ทดสอบ\s*push$/i.test(t.trim())) return true;
  if (/^เทส\s*push$/i.test(t.trim())) return true;
  return false;
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

  if (event.type !== "message") return;
  const msgEvent = event as MessageEvent;
  const uid = messageEventUserId(msgEvent);
  if (!uid) return;
  const text = textOf(msgEvent);
  if (!text) return;

  const lower = text.toLowerCase();
  if (lower === "help" || lower === "ช่วยเหลือ" || lower === "?") {
    await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: HELP }]);
    return;
  }

  if (isLineUserIdQuery(text)) {
    if (msgEvent.source.type !== "user") {
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: "คำสั่งนี้ใช้ได้เฉพาะแชท 1:1 กับ Koji — เปิดแชทส่วนตัวกับบอทแล้วพิมพ์ ไอดีไลน์ อีกครั้ง",
        },
      ]);
      return;
    }
    await client.replyMessage(msgEvent.replyToken, [
      {
        type: "text",
        text: [
          "LINE user id ของคุณ (ใส่ใน env ได้ตรง ๆ):",
          "",
          uid,
          "",
          "ตัวอย่าง: SPARK_MATRIX_RESET_ALLOWED_USER_IDS=" + uid,
        ].join("\n"),
      },
    ]);
    return;
  }

  if (isCronStatusQuery(text)) {
    try {
      const bundle = await loadCronStatusBundle();
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: formatCronStatusForLine(bundle) },
      ]);
    } catch (e) {
      console.error("[lineHandler] cron status", e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: "อ่านสถานะ cron ไม่สำเร็จ — บน Vercel ต้องมี REDIS_URL หรือ Vercel KV" },
      ]);
    }
    return;
  }

  if (isWebhookPushTestQuery(text)) {
    try {
      const body = [
        "🧪 ทดสอบแจ้งเตือน (จาก LINE webhook)",
        `UTC: ${new Date().toISOString()}`,
        "",
        "ช่องเดียวกับ cron — Telegram → Discord → LINE ตาม env",
      ].join("\n");
      await sendAlertNotification(client, uid, body);
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: "✅ ส่งทดสอบแล้ว — ดูที่ Telegram / Discord หรือข้อความ push ในแชท (ตาม env)",
        },
      ]);
    } catch (e) {
      console.error("[lineHandler] webhook test alert", e);
      const detail = e instanceof Error ? e.message : String(e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: `❌ ทดสอบไม่สำเร็จ: ${detail}` },
      ]);
    }
    return;
  }

  if (isKojiMenuTrigger(text)) {
    const subscribedSystem = await hasSystemChangeSubscriber(uid);
    await client.replyMessage(msgEvent.replyToken, [
      {
        type: "flex",
        altText: subscribedSystem ? KOJI_MENU_ALT_TEXT : KOJI_MENU_ALT_TEXT_NO_TOP_FUNDING,
        contents: buildKojiWelcomeFlexContents(config.liffId, {
          subscribedSystemChange: subscribedSystem,
        }),
      },
    ]);
    return;
  }

  if (isSystemSubscribeStatusQuery(text)) {
    const on = await hasSystemChangeSubscriber(uid);
    await client.replyMessage(msgEvent.replyToken, [
      {
        type: "text",
        text: on
          ? "สถานะ: เปิดรับแจ้งเตือน System conditions อยู่ (funding rate / รอบชำระ / max order size · Top 50 |funding|)"
          : "สถานะ: ยังไม่ได้เปิดรับ — พิมพ์ ติดตามระบบ เพื่อเปิด",
      },
    ]);
    return;
  }

  const checklist = parsePositionChecklist(text);
  if (checklist) {
    try {
      const body = await buildPositionChecklistMessage(checklist);
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: body }]);
    } catch (e) {
      console.error("[lineHandler] position checklist", e);
      const detail = e instanceof Error ? e.message : String(e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: `สร้าง checklist ไม่สำเร็จ — ${detail.slice(0, 300)}` },
      ]);
    }
    return;
  }

  if (isSparkStatsQuery(text)) {
    try {
      const body = await formatSparkStatsMessage();
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: body }]);
    } catch (e) {
      console.error("[lineHandler] spark stats", e);
      const detail = e instanceof Error ? e.message : String(e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: `อ่านสถิติ Spark ไม่สำเร็จ — ${detail.slice(0, 300)}` },
      ]);
    }
    return;
  }

  if (isSparkMatrixResetCommand(text)) {
    if (!isSparkMatrixResetAllowed(uid)) {
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: [
            "ไม่ได้รับอนุญาตให้ล้างสถิติ Spark",
            "",
            "ตั้งค่า env: SPARK_MATRIX_RESET_ALLOWED_USER_IDS=<LINE user id ของคุณ>",
            "(หลายคนคั่นด้วยจุลภาค) แล้ว redeploy — หรือใช้ GET /api/cron/reset-spark-state + Bearer CRON_SECRET",
          ].join("\n"),
        },
      ]);
      return;
    }
    try {
      await resetSparkFollowUpState();
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: [
            "✅ ล้างข้อมูล Spark matrix แล้ว",
            "",
            "ล้าง: คิว follow-up · history (win-rate) · recentSparks (fire log)",
            "ไม่แตะ: price spike state อื่น",
            "",
            "เปิด LIFF «สถิติ Spark» จะเห็นข้อมูลว่างจนมี Spark ใหม่",
          ].join("\n"),
        },
      ]);
    } catch (e) {
      console.error("[lineHandler] spark matrix reset", e);
      const detail = e instanceof Error ? e.message : String(e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: `ล้างไม่สำเร็จ — ${detail.slice(0, 300)}` },
      ]);
    }
    return;
  }

  if (isMarketPulseStatusQuery(text)) {
    try {
      const body = await getMarketPulseStatusMessage();
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: body }]);
    } catch (e) {
      const detail =
        e instanceof Error ? e.message : String(e);
      console.error("[lineHandler] market pulse status", e);
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: `ดึงสถานะ sentiment ไม่สำเร็จ — ลองใหม่ภายหลัง (${detail.slice(0, 200)})`,
        },
      ]);
    }
    return;
  }

  const sysCmd = parseSystemChangeSubscribeCommand(text);
  if (sysCmd) {
    try {
      if (sysCmd === "on") {
        const added = await addSystemChangeSubscriber(uid);
        await client.replyMessage(msgEvent.replyToken, [
          {
            type: "text",
            text: added
              ? [
                  "เปิดรับแจ้งเตือน System conditions แล้ว",
                  "",
                  "• แจ้งเมื่อ funding rate / รอบชำระ / max order size เปลี่ยน (สัญญา Top 50 |funding|)",
                  "• เซิร์ฟเวอร์เช็ครายชั่วโมง (cron) — รอบแรกจะบันทึกค่าอ้างอิงเท่านั้น ยังไม่ส่งแจ้งเตือน",
                  "• จะได้ LINE เมื่อค่าเปลี่ยนจริงจากรอบก่อน — ถ้ายังเงียบ = ยังไม่ถึงเกณฑ์หรือยังไม่ถึงรอบถัดไป",
                  "",
                  "พิมพ์ สถานะติดตามระบบ เพื่อเช็คอีกครั้ง",
                ].join("\n")
              : "คุณเปิดรับอยู่แล้ว — พิมพ์ สถานะติดตามระบบ เพื่อเช็ค",
          },
        ]);
      } else {
        const removed = await removeSystemChangeSubscriber(uid);
        await client.replyMessage(msgEvent.replyToken, [
          {
            type: "text",
            text: removed ? "ปิดรับแจ้งเตือน System conditions แล้ว" : "คุณยังไม่ได้เปิดรับ",
          },
        ]);
      }
    } catch (e) {
      console.error("[lineHandler] system change subscribe storage", e);
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: "บันทึกการตั้งค่าไม่สำเร็จ — บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL)",
        },
      ]);
    }
    return;
  }

  if (isPctAlertsListQuery(text)) {
    const list = await listPctStepAlertsForUser(uid);
    if (list.length === 0) {
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: "ยังไม่มีรายการแจ้งเตือนการเคลื่อนไหวราคา" },
      ]);
      return;
    }
    const body = list
      .map((a, i) => {
        const modeLabel = a.mode === "trailing" ? "trailing" : "รายวัน 07:00";
        return `${i + 1}. ${a.coinId} ทุก ${a.stepPct}% (${modeLabel})`;
      })
      .join("\n");
    await client.replyMessage(msgEvent.replyToken, [
      { type: "text", text: `แจ้งเตือนการเคลื่อนไหวราคา:\n${body}` },
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

  const unPctIdx = parseUnpctCmd(text);
  if (unPctIdx !== null) {
    const ok = await removePctStepAlertByIndex(uid, unPctIdx);
    await client.replyMessage(msgEvent.replyToken, [
      { type: "text", text: ok ? "ลบรายการแจ้งเตือนการเคลื่อนไหวราคาแล้ว" : "ไม่พบลำดับนี้" },
    ]);
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

  const pctAlert = parsePctAlertCmd(text);
  if (pctAlert) {
    const resolved = resolveContractSymbol(pctAlert.symbol);
    if (!resolved) {
      await client.replyMessage(msgEvent.replyToken, [{ type: "text", text: "ไม่รู้จักคู่นี้ (ลอง btc หรือ BTC_USDT)" }]);
      return;
    }
    try {
      await addPctStepAlert({
        userId: uid,
        coinId: resolved.contractSymbol,
        symbolLabel: resolved.label,
        stepPct: pctAlert.stepPct,
        mode: pctAlert.mode,
      });
      const modeTh = pctAlert.mode === "trailing" ? "trailing" : "รายวัน (anchor 07:00 ไทย)";
      await client.replyMessage(msgEvent.replyToken, [
        {
          type: "text",
          text: `ตั้งแจ้งเตือนการเคลื่อนไหวราคา ${resolved.contractSymbol} ทุก ${pctAlert.stepPct}% — ${modeTh}`,
        },
      ]);
    } catch (e) {
      console.error("[lineHandler] addPctStepAlert", e);
      await client.replyMessage(msgEvent.replyToken, [
        { type: "text", text: "บันทึกไม่สำเร็จ — บน Vercel ต้องมี REDIS_URL หรือ Vercel KV" },
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
