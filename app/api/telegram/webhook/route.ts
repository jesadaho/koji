import { NextRequest, NextResponse } from "next/server";
import { escapeTelegramHtml, sendTelegramMessageToChat, wrapTelegramPreMonospace } from "@/src/telegramAlert";
import { formatTradingViewMexcWebhookJson, getTradingViewMexcWebhookCloseUrl } from "@/src/liffService";
import { ensureTradingViewMexcUserRow, getTradingViewMexcRowOptional } from "@/src/tradingViewCloseSettingsStore";
import { mexcFuturesBaseUrl, verifyMexcFuturesApiForUser } from "@/src/mexcFuturesClient";
import { buildTelegramPortfolioStatusMessages } from "@/src/portfolioStatusService";
import { tgUserIdToStoreKey } from "@/src/telegramMiniAppAuth";
import { parseMarketCheck, parsePositionChecklist } from "@/src/positionChecklistLineCommands";
import { buildMarketCheckMessage, buildPositionChecklistMessage } from "@/src/positionChecklistService";
import {
  isSparkMatrixResetCommand,
  isSparkMatrixResetAllowed,
  isSparkStatsQuery,
} from "@/src/sparkFollowUpLineCommands";
import { resetSparkFollowUpState } from "@/src/sparkFollowUpStore";
import { formatSparkStatsMessage } from "@/src/sparkFollowUpStats";
import { handleTvOpenWizardTelegramMessage } from "@/src/tradingViewOpenWizardTelegram";
import { resolveContractSymbol } from "@/src/coinMap";
import { loadPriceSpike15mAlertState } from "@/src/priceSpike15mAlertStateStore";
import {
  fetchContractTickerMetrics,
  getTopUsdtSymbolsByAmount24,
  sparkMinAmount24Usdt,
} from "@/src/mexcMarkets";
import { createLineClientForCron } from "@/src/lineHandler";
import { runPctStepTrailingPriceAlertTick } from "@/src/pctStepPriceAlertTick";
import { runPriceSpike15mAlertTick } from "@/src/priceSpike15mAlertTick";
import { runSparkFollowUpTick } from "@/src/sparkFollowUpTick";
import { runPriceAlertTick } from "@/src/priceAlertTick";
import { runPctStepDailyPriceAlertTick } from "@/src/pctStepPriceAlertTick";
import { runVolumeSignalAlertTick } from "@/src/volumeSignalAlertTick";
import { runIndicatorAlertTick, runSnowballPublicScanTick } from "@/src/indicatorAlertWorker";
import { runSpotFutBasisAlertTick } from "@/src/spotFutBasisAlertTick";
import { runThreeGreenDailyTechnicalAlertTick } from "@/src/threeGreenDailyAlertTick";
import { isAdminTelegramUserId } from "@/src/adminIds";
import { removeSnowballStatsDuplicatesInLastHours, resetSnowballStatsState } from "@/src/snowballStatsStore";
import { clearSnowballSymbolForManualRetry } from "@/src/snowballManualSymbolClear";
import {
  formatPublicIndicatorFeedDebugMessage,
  formatReversalRiskDebugMessage,
  formatSnowballChecklistDebugMessage,
  parsePublicFeedDebugCommand,
  parseReversalRiskDebugCommand,
  parseSnowballDebugCommand,
} from "@/src/publicIndicatorFeedDebug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** เช็คลิสต์ดึงหลาย API — บน Vercel Pro ใช้ได้ถึง 60s; แพลนฟรีอาจ timeout ที่ 10s */
export const maxDuration = 60;

/** ปิดคำสั่ง /chatid — ค่าเริ่มเปิด */
function telegramWebhookChatIdCommandEnabled(): boolean {
  const v = process.env.TELEGRAM_WEBHOOK_CHATID_CMD_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

/** /chatid · #chatid · chat id · ไอดีแชท */
function wantsTelegramChatIdCommand(trimmed: string, normalized: string): boolean {
  if (!telegramWebhookChatIdCommandEnabled()) return false;
  const t = trimmed.toLowerCase();
  const n = normalized.toLowerCase().trim();
  return n === "chatid" || t === "#chatid" || t === "chat id" || t === "ไอดีแชท";
}

/** `/short@bot btc` → `short btc` — ให้ตรงกับพาร์สเซอร์แบบ LINE */
function normalizeTelegramSlashCommand(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("/")) return t;
  let rest = t.slice(1);
  const m = rest.match(/^([a-zA-Z_]+)@\S+\s*([\s\S]*)$/);
  if (m) {
    rest = `${m[1]!} ${m[2] ?? ""}`.trim();
  }
  return rest;
}

/** URL ที่เปิด Mini App (BotFather Menu Button / ปุ่ม web_app) */
function miniAppOpenUrl(): string {
  const raw =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = raw.replace(/\/$/, "");
  return base ? `${base}/` : "";
}

function parseSparkLogCmd(t: string): string | null {
  const s = t.trim();
  const m =
    s.match(/^(?:spark\s*(?:log|logs|history)|sparklog|price\s*logs)\s+(\S+)\s*$/i) ||
    s.match(/^(?:สปาร์ค\s*log|สปาร์ค\s*logs|ราคาย้อนหลัง\s*spark)\s+(\S+)\s*$/i);
  return m?.[1]?.trim() ?? null;
}

function parseSparkRankCmd(t: string): string | null {
  const s = t.trim();
  const m =
    s.match(/^(?:spark\s*(?:rank|universe|u))\s+(\S+)\s*$/i) ||
    s.match(/^(?:สปาร์ค\s*(?:rank|แรงค์|ยูนิเวิร์ส))\s+(\S+)\s*$/i);
  return m?.[1]?.trim() ?? null;
}

function sparkTopNConfigured(): number {
  const n = Number(process.env.PRICE_SPIKE_15M_TOP_N?.trim());
  return Number.isFinite(n) && n >= 5 && n <= 200 ? Math.floor(n) : 100;
}

/** portfolio · portfolio status · พอร์ต · สรุปพอร์ต — slash เช่น /portfolio */
function wantsPortfolioStatusCommand(trimmed: string, normalized: string): boolean {
  const collapse = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const raw = trimmed.trim();
  if (/^\/?portfolio(?:@\S+)?\s*$/i.test(raw)) return true;
  if (/^\/?portfolio\s+status(?:@\S+)?\s*$/i.test(raw)) return true;
  const cand = collapse(normalized) || collapse(trimmed);
  return (
    cand === "portfolio" ||
    cand === "portfolio status" ||
    cand === "port status" ||
    cand === "พอร์ต" ||
    cand === "สรุปพอร์ต" ||
    cand === "สถานะพอร์ต"
  );
}

/** ล้างสถิติ Snowball — admin only */
function isSnowballStatsResetCommand(trimmed: string, normalized: string): boolean {
  const t = trimmed.trim();
  const n = normalized.trim().toLowerCase();
  if (/^\/?snowball\s*(?:reset|clear)(?:@\S+)?\s*$/i.test(t)) return true;
  if (/^\/?reset\s*snowball(?:@\S+)?\s*$/i.test(t)) return true;
  if (t === "#snowballreset") return true;
  return (
    n === "snowball reset" ||
    n === "reset snowball" ||
    n === "ล้างสถิติ snowball" ||
    n === "ล้างสถิติ สโนว์บอล" ||
    n === "ล้างสถิติsnowball"
  );
}

/** ลบแถวซ้ำ Snowball stats ใน 24h (คงแถวล่าสุด) — admin only */
function parseSnowballStatsDedupeCommand(trimmed: string, normalized: string): { symbol?: string } | null {
  const t = trimmed.trim();
  const n = normalized.trim().replace(/\s+/g, " ").toLowerCase();

  // slash forms
  let m = t.match(/^\/?snowball\s+(?:dedupe|dedup|dupes|duplicates)(?:@\S+)?\s*(\S+)?\s*$/i);
  if (m) return { symbol: m[1]?.trim() || undefined };
  m = t.match(/^\/?snowball\s+clear\s+dupes?(?:@\S+)?\s*(\S+)?\s*$/i);
  if (m) return { symbol: m[1]?.trim() || undefined };

  // text forms
  m = n.match(/^(?:snowball\s+dedupe|snowball\s+clear\s+dupes|clear\s+snowball\s+dupes)(?:\s+(\S+))?$/i);
  if (m) return { symbol: m[1]?.trim() || undefined };
  return null;
}

/** ลบแถวสถิติ Snowball + ปลดล็อกยิงซ้ำต่อสัญญา — admin only */
function parseSnowballStatsRemoveSymbolCommand(trimmed: string, normalized: string): string | null {
  const t = trimmed.trim();
  const n = normalized.trim().replace(/\s+/g, " ").toLowerCase();

  let m = t.match(/^\/?snowball\s+stats\s+(?:remove|rm|delete|del)(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return m[1].trim();

  m = t.match(/^\/?(?:remove|rm)\s+snowball\s+stats(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return m[1].trim();

  if (/^#snowballstats(?:remove|rm|delete)\s+\S+/i.test(t)) {
    const mm = t.match(/^#snowballstats(?:remove|rm|delete)\s+(\S+)\s*$/i);
    return mm?.[1]?.trim() ?? null;
  }

  const th = n.match(/^ลบสถิติ\s+(?:snowball|สโนว์บอล)\s+(\S+)\s*$/);
  if (th?.[1]) return th[1].trim();

  return null;
}

function formatBkkFromSec(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} (BKK)`;
}

function formatPriceMaybe(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 1) return p.toFixed(6);
  if (p < 100) return p.toFixed(4);
  if (p < 1000) return p.toFixed(2);
  return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isTelegramCronRunAllowed(fromUserId: number | undefined): boolean {
  return isAdminTelegramUserId(fromUserId);
}

type CronRunScope = "pct-trailing" | "price-sync" | "snowball-scan";

function parseRunCronCmd(t: string): { scope: CronRunScope; verbose: boolean } | null {
  const s = t.trim().replace(/\s+/g, " ");
  let m = s.match(
    /^(?:run\s+cron|cron\s+run|runc|runcron)\s+(pct-trailing|pct_trailing|spark|price-sync|price_sync|snowball|snowball-scan|snowball_scan)(?:\s+(v|verbose))?\s*$/i
  );
  if (m) {
    const key = m[1]!.toLowerCase();
    const verbose = Boolean(m[2]);
    if (key === "spark" || key === "pct-trailing" || key === "pct_trailing") return { scope: "pct-trailing", verbose };
    if (key === "price-sync" || key === "price_sync") return { scope: "price-sync", verbose };
    if (key === "snowball" || key === "snowball-scan" || key === "snowball_scan") return { scope: "snowball-scan", verbose };
  }
  m = s.match(
    /^(?:รัน\s*cron|สั่งรัน\s*cron|รันcron)\s+(spark|pct-trailing|price-sync|snowball|สโนว์บอล)(?:\s+(v|verbose))?\s*$/i
  );
  if (m) {
    const key = m[1]!.toLowerCase();
    const verbose = Boolean(m[2]);
    if (key === "spark" || key === "pct-trailing") return { scope: "pct-trailing", verbose };
    if (key === "price-sync") return { scope: "price-sync", verbose };
    if (key === "snowball" || key === "สโนว์บอล") return { scope: "snowball-scan", verbose };
  }
  return null;
}

/**
 * Telegram Bot webhook — รับข้อความจากผู้ใช้ (โดยทั่วไปแชทส่วนตัวกับบอท)
 * /start … · debug public feed / debug snowball / debug reversal risk (admin) · run cron price-sync | snowball | spark (admin — KOJI_ADMIN_IDS)
 * · snowball stats remove SYMBOL — ลบแถวสถิติ + ปลดล็อกยิง Snowball ต่อสัญญา (admin)
 * กลุ่มสาธารณะ (TELEGRAM_PUBLIC_*) ใช้แค่ส่งแจ้งเตือนจาก cron — ไม่ต้องคุยคำสั่งในกลุ่มก็ได้
 * ถ้าไปพิมพ์คำสั่งใน supergroup แทน DM และเปิด Group Privacy ต้องใช้ `/short btc` ฯลฯ
 * ตั้ง webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<https://host>/api/telegram/webhook`
 * (ไม่บังคับ secret — ถ้าต้องการกันคนอื่นยิง POST ปลอม ค่อยใส่ secret_token + ตรวจ header ทีหลัง)
 */
export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN" }, { status: 503 });
  }

  let update: {
    message?: {
      chat?: { id?: number; type?: string };
      text?: string;
      message_thread_id?: number;
      from?: { id?: number };
    };
  };
  try {
    update = (await req.json()) as typeof update;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatType = update.message?.chat?.type;
  const chatId = update.message?.chat?.id;
  const replyThreadId = update.message?.message_thread_id;
  const threadOpts =
    replyThreadId != null && replyThreadId > 0 ? { messageThreadId: replyThreadId } : undefined;
  if (chatId == null) {
    return NextResponse.json({ ok: true });
  }

  if (text === "/start" || text.startsWith("/start ")) {
    const url = miniAppOpenUrl();
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: url
        ? "Koji — แตะปุ่มด้านล่างเพื่อเปิด Mini App"
        : "ตั้ง TELEGRAM_MINI_APP_URL หรือ NEXT_PUBLIC_APP_URL แล้วตั้ง Web App URL ใน BotFather",
    };
    if (url) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: "เปิด Koji", web_app: { url } }]],
      };
    }

    try {
      const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("[telegram/webhook] sendMessage", r.status, t.slice(0, 300));
      }
    } catch (e) {
      console.error("[telegram/webhook] sendMessage", e);
    }
    return NextResponse.json({ ok: true });
  }

  if (!text) {
    return NextResponse.json({ ok: true });
  }

  const normalized = normalizeTelegramSlashCommand(text);
  const fromUserId = update.message?.from?.id;

  const trimmedText = text.trim();

  const snowDbg = parseSnowballDebugCommand(normalized) || parseSnowballDebugCommand(trimmedText);
  if (snowDbg) {
    if (!isTelegramCronRunAllowed(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          "คำสั่ง debug snowball ต้องเป็น admin — ตั้ง KOJI_ADMIN_IDS=<telegram user id>",
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] snowball debug deny", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const body = await formatSnowballChecklistDebugMessage(snowDbg.symbol);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[telegram/webhook] snowball debug", e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `debug snowball ล้มเหลว — ${detail.slice(0, 800)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] snowball debug error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const revDbg = parseReversalRiskDebugCommand(normalized) || parseReversalRiskDebugCommand(trimmedText);
  if (revDbg) {
    if (!isTelegramCronRunAllowed(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          "คำสั่ง debug reversal risk ต้องเป็น admin — ตั้ง KOJI_ADMIN_IDS=<telegram user id>",
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] reversal risk debug deny", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const body = await formatReversalRiskDebugMessage(revDbg.symbol);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[telegram/webhook] reversal risk debug", e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `debug reversal risk ล้มเหลว — ${detail.slice(0, 800)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] reversal risk debug error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const feedDbg = parsePublicFeedDebugCommand(normalized) || parsePublicFeedDebugCommand(trimmedText);
  if (feedDbg) {
    if (!isTelegramCronRunAllowed(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          "คำสั่ง debug public feed ต้องเป็น admin — ตั้ง KOJI_ADMIN_IDS=<telegram user id>",
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] public feed debug deny", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const body = await formatPublicIndicatorFeedDebugMessage({ symbol: feedDbg.symbol });
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[telegram/webhook] public feed debug", e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `debug public feed ล้มเหลว — ${detail.slice(0, 800)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] public feed debug error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const runReq = parseRunCronCmd(normalized) || parseRunCronCmd(trimmedText);
  if (runReq) {
    if (!isTelegramCronRunAllowed(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          "คำสั่งรัน cron ถูกปิดหรือไม่ได้รับอนุญาต — ตั้ง KOJI_ADMIN_IDS=<telegram user id> ก่อน",
          threadOpts
        );
      } catch (e) {
        console.error("[telegram/webhook] run cron deny reply", e);
      }
      return NextResponse.json({ ok: true });
    }

    const started = Date.now();
    const atIso = new Date().toISOString();
    const client = createLineClientForCron();
    try {
      if (runReq.scope === "pct-trailing") {
        const verbose = runReq.verbose;
        const topN = sparkTopNConfigured();
        const minAmt = sparkMinAmount24Usdt();

        // step 1: universe snapshot (same source as spark tick)
        const universe = await getTopUsdtSymbolsByAmount24(topN);
        const target = "BSB_USDT";
        const targetRank = universe.indexOf(target);
        const sampleSyms = Array.from(
          new Set([target, universe[0], universe[1], universe[2], universe[3]].filter(Boolean))
        ) as string[];

        // step 2: probe ticker metrics (to see nulls)
        const probe = await Promise.all(
          sampleSyms.map(async (sym) => {
            const m = await fetchContractTickerMetrics(sym);
            return {
              sym,
              ok: m != null && Number.isFinite(m.lastPrice) && m.lastPrice > 0,
              lastPrice: m?.lastPrice ?? null,
              amount24: m?.amount24Usdt ?? null,
            };
          })
        );

        // step 3: state before
        const before = await loadPriceSpike15mAlertState();
        const beforeRow = before[target];

        const [trailing, spark, follow] = await Promise.allSettled([
          runPctStepTrailingPriceAlertTick(client),
          runPriceSpike15mAlertTick(client),
          runSparkFollowUpTick(client),
        ]);

        // step 4: state after
        const after = await loadPriceSpike15mAlertState();
        const afterRow = after[target];
        const beforeCp = beforeRow?.checkpointSec ?? null;
        const afterCp = afterRow?.checkpointSec ?? null;
        const beforeSamples = beforeRow?.priceSamples?.length ?? 0;
        const afterSamples = afterRow?.priceSamples?.length ?? 0;

        const lines = [
          "🟦 Koji — run cron (pct-trailing)",
          `UTC: ${atIso}`,
          `durationMs: ${Date.now() - started}`,
          "",
          `trailingPct: ${trailing.status === "fulfilled" ? `ok (notified ${trailing.value.notified})` : `fail — ${(trailing.reason as Error)?.message ?? String(trailing.reason)}`}`,
          `sparkTicker: ${spark.status === "fulfilled" ? `ok (hit ${spark.value.symbolsHit}, push ${spark.value.notifiedPushes})` : `fail — ${(spark.reason as Error)?.message ?? String(spark.reason)}`}`,
          `sparkFollowUp: ${follow.status === "fulfilled" ? `ok (checkpoints ${follow.value.checkpoints}, resolved ${follow.value.resolvedEvents})` : `fail — ${(follow.reason as Error)?.message ?? String(follow.reason)}`}`,
        ];
        if (verbose) {
          lines.push(
            "",
            "— spark debug (step-by-step) —",
            `topN=${topN} · minAmount24=${minAmt.toLocaleString()}`,
            `universeCount=${universe.length} · ${target} rank=${targetRank >= 0 ? `${targetRank + 1}/${universe.length}` : "not in list"}`,
            `probe: ${probe
              .map((p) => `${p.sym}=${p.ok ? "ok" : "null"}(p:${p.lastPrice ?? "—"},a24:${p.amount24 ?? "—"})`)
              .join(" · ")}`,
            `state ${target} before: checkpointSec=${beforeCp ?? "—"} samplesTotal=${beforeSamples}`,
            `state ${target} after:  checkpointSec=${afterCp ?? "—"} samplesTotal=${afterSamples}`,
            beforeCp != null && afterCp != null ? `stateChanged: ${afterCp > beforeCp ? "yes" : "no"}` : "stateChanged: —"
          );
        }
        await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
      } else if (runReq.scope === "snowball-scan") {
        const r = await runSnowballPublicScanTick(client);
        const lines = [
          "🟪 Koji — run cron (snowball-scan)",
          `UTC: ${atIso}`,
          `durationMs: ${Date.now() - started}`,
          "",
          `notified: ${r.notified}`,
          `detail: ${r.detail}`,
        ];
        if (r.scanSkippedReason) lines.push("", `scanSkippedReason: ${r.scanSkippedReason}`);
        if (r.snowballScanSummaryText) {
          const raw = r.snowballScanSummaryText;
          const max = 3200;
          lines.push(
            "",
            "— snowball 4h scan summary —",
            raw.length <= max ? raw : `${raw.slice(0, max)}\n… (ยาว ${raw.length} ตัวอักษร — ตัดในแชท; ดูเต็มใน response cron หรือกลุ่มสาธารณะ)`
          );
        }
        await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
      } else {
        const steps = await Promise.allSettled([
          (async () => runPriceAlertTick(client))(),
          runPctStepDailyPriceAlertTick(client),
          runVolumeSignalAlertTick(client),
          runIndicatorAlertTick(client),
          runSpotFutBasisAlertTick(client),
          runThreeGreenDailyTechnicalAlertTick(),
        ]);
        const fmt = (name: string, r: PromiseSettledResult<unknown>) =>
          `${name}: ${r.status === "fulfilled" ? "ok" : `fail — ${(r.reason as Error)?.message ?? String(r.reason)}`}`;
        const lines = [
          "🟩 Koji — run cron (price-sync)",
          `UTC: ${atIso}`,
          `durationMs: ${Date.now() - started}`,
          "",
          fmt("priceAlerts", steps[0]!),
          fmt("pctStepAlerts", steps[1]!),
          fmt("volumeSignalAlerts", steps[2]!),
          fmt("indicatorAlerts", steps[3]!),
          fmt("spotFutBasisAlerts", steps[4]!),
          fmt("threeGreenDailyTechnical", steps[5]!),
        ];
        await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[telegram/webhook] run cron", e);
      try {
        await sendTelegramMessageToChat(String(chatId), `run cron ไม่สำเร็จ — ${detail.slice(0, 800)}`, threadOpts);
      } catch (sendErr) {
        console.error("[telegram/webhook] run cron error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (wantsTelegramChatIdCommand(trimmedText, normalized)) {
    const lines = [
      "Koji — chat / topic (สำหรับใส่ .env)",
      `chat_id: ${chatId}`,
      `ประเภทแชท: ${chatType ?? "—"}`,
      replyThreadId != null && replyThreadId > 0
        ? `message_thread_id (Forum topic): ${replyThreadId}`
        : "message_thread_id: — (ไม่ใช่ข้อความใน topic / แชทธรรมดา)",
      typeof fromUserId === "number" && fromUserId > 0 ? `จากผู้ใช้ (from id): ${fromUserId}` : "",
      "",
      "ตัวอย่าง:",
      "• DM / แชทส่วนตัว → TELEGRAM_ALERT_CHAT_ID",
      "• กลุ่มสาธารณะ → TELEGRAM_PUBLIC_CHAT_ID (มักขึ้นต้น -100…)",
      "• หัวข้อในกลุ่ม Forum → TELEGRAM_PUBLIC_*_MESSAGE_THREAD_ID ตามชนิด",
    ].filter(Boolean);
    try {
      await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] chatid reply", e);
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof fromUserId === "number" && fromUserId > 0 && chatId != null) {
    const wizardHandled = await handleTvOpenWizardTelegramMessage({
      text,
      trimmedText,
      normalized,
      chatType,
      fromUserId,
      chatId,
      threadOpts,
    });
    if (wizardHandled) {
      return NextResponse.json({ ok: true });
    }
  }

  const tvClosePhraseNorm = trimmedText.replace(/\s+/g, " ").trim().toLowerCase();
  const wantsWebhookJsonClose =
    trimmedText === "ขอรับ Webhook JSON MEXC" ||
    tvClosePhraseNorm === "ขอรับ webhook json close" ||
    (normalized === "webhook_json" && !normalized.startsWith("webhook_json_open"));

  if (wantsWebhookJsonClose && typeof fromUserId === "number" && fromUserId > 0) {
    try {
      const userId = tgUserIdToStoreKey(fromUserId);
      const row = await ensureTradingViewMexcUserRow(userId);
      if (!row.mexcApiKey?.trim() || !row.mexcSecret?.trim()) {
        await sendTelegramMessageToChat(
          String(chatId),
          "ยังขอ Webhook JSON ไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน",
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const json = formatTradingViewMexcWebhookJson(userId, row.webhookToken);
      const pre = wrapTelegramPreMonospace(json);
      const webhookUrl = getTradingViewMexcWebhookCloseUrl();
      const urlLine = `<b>Webhook URL</b> (TradingView → URL)\n<code>${escapeTelegramHtml(webhookUrl)}</code>`;
      const nonceHint =
        "\n\n<i>nonce ใน JSON ใช้ครั้งเดียว — ถ้า TV ส่งซ้ำด้วย body เดิมจะถูกปฏิเสธ แนะนำตั้งเป็น \"nonce\": \"{{timenow}}\" ใน TradingView</i>";
      const msg = pre
        ? `Koji — MEXC\n${urlLine}\n\n<b>Webhook JSON</b> (TradingView → Message / body)\n\n${pre}${nonceHint}`
        : `Koji — MEXC\n${urlLine}\n\n<b>Webhook JSON</b>\n\n(ข้อความยาว) — ใช้หน้า Settings ใน Mini App แทน\n\n${escapeTelegramHtml(json.slice(0, 2000))}${nonceHint}`;
      await sendTelegramMessageToChat(String(chatId), msg, { parseMode: "HTML" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `Webhooks JSON: อ่านการตั้งค่าไม่สำเร็จ — ${detail.slice(0, 500)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] webhook json reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const wantsMexcApiCheck =
    trimmedText === "เช็ค MEXC API" || /^\/?mexc_api(@\S+)?\s*$/i.test(normalized);

  if (wantsMexcApiCheck && typeof fromUserId === "number" && fromUserId > 0) {
    try {
      const userId = tgUserIdToStoreKey(fromUserId);
      const row = await getTradingViewMexcRowOptional(userId);
      if (!row?.mexcApiKey?.trim() || !row.mexcSecret?.trim()) {
        await sendTelegramMessageToChat(
          String(chatId),
          "ยังเช็ค MEXC API ไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน",
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const r = await verifyMexcFuturesApiForUser({ apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() });
      if (!r.ok) {
        const stepTh =
          r.step === "account_assets"
            ? "อ่านทรัพย์สินฟิวเจอร์"
            : r.step === "position_mode"
              ? "อ่านโหมด position"
              : r.step === "open_positions"
                ? "อ่าน position ที่เปิด"
                : "เครือข่าย/เซิร์ฟเวอร์";
        const codePart = r.code != null ? `\nรหัส MEXC: ${r.code}` : "";
        await sendTelegramMessageToChat(
          String(chatId),
          `MEXC API — เช็คแล้ว ❌\nขั้น ${stepTh} ไม่ผ่าน${codePart}\n${r.message.slice(0, 800)}\n\nลอง: สิทธิ์ API (View + Order ถ้าต้องสั่งปิด) / IP whitelist / เวลาเครื่อง / host ${mexcFuturesBaseUrl()}`,
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const symLine =
        r.openSymbolsSample.length > 0
          ? `\nสัญญาที่เปิดอยู่ (ตัวอย่าง): ${r.openSymbolsSample.join(", ")}`
          : "";
      await sendTelegramMessageToChat(
        String(chatId),
        `MEXC API — เช็คแล้ว ✅\n• USDT ใช้ได้ (ฟิวเจอร์): ${r.usdtAvailable}\n• โหมด position: ${r.positionModeLabel}\n• จำนวน position เปิด: ${r.openPositionsCount}${symLine}`,
        threadOpts,
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `เช็ค MEXC API ไม่สำเร็จ — ${detail.slice(0, 500)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] mexc api check reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (wantsPortfolioStatusCommand(trimmedText, normalized) && typeof fromUserId === "number" && fromUserId > 0) {
    try {
      const userId = tgUserIdToStoreKey(fromUserId);
      const row = await getTradingViewMexcRowOptional(userId);
      if (!row?.mexcApiKey?.trim() || !row.mexcSecret?.trim()) {
        await sendTelegramMessageToChat(
          String(chatId),
          "ยังดูสถานะพอร์ตไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน",
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const msgs = await buildTelegramPortfolioStatusMessages({
        apiKey: row.mexcApiKey.trim(),
        secret: row.mexcSecret.trim(),
      });
      for (const part of msgs) {
        await sendTelegramMessageToChat(String(chatId), part, threadOpts);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `สถานะพอร์ตไม่สำเร็จ — ${detail.slice(0, 500)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] portfolio status reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (isSparkStatsQuery(text) || isSparkStatsQuery(normalized)) {
    try {
      const body = await formatSparkStatsMessage();
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] spark stats", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `อ่านสถิติ Spark ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] spark stats error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (isSparkMatrixResetCommand(text) || isSparkMatrixResetCommand(normalized)) {
    const uidStr = fromUserId != null && fromUserId > 0 ? String(fromUserId) : "";
    if (!uidStr || !isSparkMatrixResetAllowed(uidStr)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          [
            "ไม่ได้รับอนุญาตให้ล้างสถิติ Spark",
            "",
            "ตั้งค่า env: KOJI_ADMIN_IDS=<Telegram user id ของคุณ>",
            "(หลายคนคั่นด้วยจุลภาค) แล้ว redeploy — หรือใช้ GET /api/cron/reset-spark-state + Bearer CRON_SECRET",
          ].join("\n"),
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] spark matrix reset deny reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      await resetSparkFollowUpState();
      await sendTelegramMessageToChat(
        String(chatId),
        [
          "✅ ล้างข้อมูล Spark matrix แล้ว",
          "",
          "ล้าง: คิว follow-up · history (win-rate) · recentSparks (fire log)",
          "ไม่แตะ: price spike state อื่น",
          "",
          "เปิด Mini App Telegram หน้า «สถิติ Spark» จะเห็นข้อมูลว่างจนมี Spark ใหม่",
        ].join("\n"),
        threadOpts,
      );
    } catch (e) {
      console.error("[telegram/webhook] spark matrix reset", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `ล้างไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] spark matrix reset error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (isSnowballStatsResetCommand(text, normalized)) {
    if (!isAdminTelegramUserId(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          [
            "ไม่ได้รับอนุญาตให้ล้างสถิติ Snowball",
            "",
            "ตั้งค่า env: KOJI_ADMIN_IDS=<Telegram user id ของคุณ>",
            "(หลายคนคั่นด้วยจุลภาค) แล้ว redeploy",
          ].join("\n"),
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] snowball stats reset deny reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      await resetSnowballStatsState();
      await sendTelegramMessageToChat(
        String(chatId),
        [
          "✅ ล้างข้อมูล Snowball stats แล้ว",
          "",
          "ล้าง: ตารางสถิติ Snowball (follow-up 4h/12h/24h · outcome · RR)",
          "",
          "เปิด Mini App Telegram หน้า «สถิติ Snowball» จะเห็นข้อมูลว่างจนมีสัญญาณใหม่",
        ].join("\n"),
        threadOpts,
      );
    } catch (e) {
      console.error("[telegram/webhook] snowball stats reset", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(String(chatId), `ล้างไม่สำเร็จ — ${detail.slice(0, 300)}`, threadOpts);
      } catch (sendErr) {
        console.error("[telegram/webhook] snowball stats reset error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const snowDedupe = parseSnowballStatsDedupeCommand(text, normalized);
  if (snowDedupe) {
    if (!isAdminTelegramUserId(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          [
            "ไม่ได้รับอนุญาตให้ล้างแถวซ้ำ Snowball stats",
            "",
            "ตั้งค่า env: KOJI_ADMIN_IDS=<Telegram user id ของคุณ>",
            "(หลายคนคั่นด้วยจุลภาค) แล้ว redeploy",
          ].join("\n"),
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] snowball stats dedupe deny reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const sym = snowDedupe.symbol;
      const r = await removeSnowballStatsDuplicatesInLastHours({ nowMs: Date.now(), windowHours: 24, symbol: sym });
      await sendTelegramMessageToChat(
        String(chatId),
        [
          "🧹 Snowball stats — clear dupes (24h)",
          sym ? `เหรียญ: ${sym.toUpperCase()}` : "เหรียญ: ทุกเหรียญ",
          "",
          `ลบ: ${r.removed} แถว`,
          `คงไว้: ${r.kept} แถว`,
        ].join("\n"),
        threadOpts,
      );
    } catch (e) {
      console.error("[telegram/webhook] snowball stats dedupe", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(String(chatId), `ทำไม่สำเร็จ — ${detail.slice(0, 300)}`, threadOpts);
      } catch (sendErr) {
        console.error("[telegram/webhook] snowball stats dedupe error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const snowRmSym = parseSnowballStatsRemoveSymbolCommand(text, normalized);
  if (snowRmSym) {
    if (!isAdminTelegramUserId(fromUserId)) {
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          [
            "ไม่ได้รับอนุญาตให้ลบสถิติ Snowball ต่อสัญญา",
            "",
            "ตั้งค่า env: KOJI_ADMIN_IDS=<Telegram user id ของคุณ>",
            "(หลายคนคั่นด้วยจุลภาค) แล้ว redeploy",
          ].join("\n"),
          threadOpts,
        );
      } catch (e) {
        console.error("[telegram/webhook] snowball stats remove deny reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const r = await clearSnowballSymbolForManualRetry(snowRmSym);
      await sendTelegramMessageToChat(
        String(chatId),
        [
          "🧹 Snowball — ลบต่อสัญญา + ปลดล็อกยิงซ้ำ",
          `สัญญา: ${r.binanceSymbol}`,
          "",
          `แถวสถิติ Mini App ที่ลบ: ${r.statsRowsRemoved}`,
          `คิว pending confirm ที่ลบ: ${r.pendingConfirmRemoved}`,
          `ล้าง state ยิง Snowball (dedupe/cooldown/wave): ${r.publicFeedSnowballKeysCleared} key`,
          "",
          "รอบ price-sync / snowball-scan ถัดไปจะประเมินแท่งล่าสุดใหม่ — ถ้าเงื่อนไขยังครบอาจยิงซ้ำได้",
        ].join("\n"),
        threadOpts,
      );
    } catch (e) {
      console.error("[telegram/webhook] snowball stats remove symbol", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(String(chatId), `ทำไม่สำเร็จ — ${detail.slice(0, 400)}`, threadOpts);
      } catch (sendErr) {
        console.error("[telegram/webhook] snowball stats remove error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const marketCheck = parseMarketCheck(normalized);
  if (marketCheck) {
    try {
      const body = await buildMarketCheckMessage(marketCheck);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] market check", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `Market check ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] market check error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const sparkRankSym = parseSparkRankCmd(normalized) || parseSparkRankCmd(text);
  if (sparkRankSym) {
    const resolved = resolveContractSymbol(sparkRankSym);
    if (!resolved) {
      try {
        await sendTelegramMessageToChat(String(chatId), "ไม่รู้จักคู่นี้ (ลอง bsb หรือ BSB_USDT)", threadOpts);
      } catch (e) {
        console.error("[telegram/webhook] spark rank unknown symbol reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const limit = sparkTopNConfigured();
      const [syms, m] = await Promise.all([
        getTopUsdtSymbolsByAmount24(limit),
        fetchContractTickerMetrics(resolved.contractSymbol),
      ]);
      const rank = syms.indexOf(resolved.contractSymbol);
      const amount24 = m?.amount24Usdt;
      const lastPrice = m?.lastPrice;
      const lines: string[] = [
        `⚡️ Spark universe — [${resolved.label}]/USDT`,
        `Contract: ${resolved.contractSymbol}`,
        "",
        `Top N: ${limit}`,
        `Min amount24 (USDT): ${sparkMinAmount24Usdt().toLocaleString()}`,
        "",
        `Now: price ${lastPrice != null ? formatPriceMaybe(lastPrice) : "—"} · amount24 ${
          amount24 != null ? amount24.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"
        }`,
        rank >= 0 ? `Status: ✅ อยู่ใน universe (rank ${rank + 1}/${syms.length})` : "Status: ❌ ไม่อยู่ใน universe ตอนนี้",
      ];
      await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] spark rank", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `เช็ค spark universe ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] spark rank error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const sparkLogSym = parseSparkLogCmd(normalized) || parseSparkLogCmd(text);
  if (sparkLogSym) {
    const resolved = resolveContractSymbol(sparkLogSym);
    if (!resolved) {
      try {
        await sendTelegramMessageToChat(String(chatId), "ไม่รู้จักคู่นี้ (ลอง bsb หรือ BSB_USDT)", threadOpts);
      } catch (e) {
        console.error("[telegram/webhook] spark log unknown symbol reply", e);
      }
      return NextResponse.json({ ok: true });
    }
    try {
      const state = await loadPriceSpike15mAlertState();
      const st = state[resolved.contractSymbol];
      if (!st) {
        await sendTelegramMessageToChat(
          String(chatId),
          [
            `⚡️ Spark price logs — [${resolved.label}]/USDT`,
            `Contract: ${resolved.contractSymbol}`,
            "",
            "ยังไม่มี price samples ใน state (มักเกิดเมื่อยังไม่เคยรอบ cron วิ่ง/หรือเหรียญไม่ได้อยู่ใน universe topN ตอนนั้น)",
          ].join("\n"),
          threadOpts
        );
        return NextResponse.json({ ok: true });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const minTs = nowSec - 3600;
      const samples = (st.priceSamples ?? [])
        .filter((x) => Number.isFinite(x.tsSec) && x.tsSec >= minTs)
        .sort((a, b) => a.tsSec - b.tsSec);

      const lines: string[] = [
        `⚡️ Spark price logs — [${resolved.label}]/USDT (ย้อนหลัง 1 ชม.)`,
        `Contract: ${resolved.contractSymbol}`,
        "",
        `Checkpoint: ${formatPriceMaybe(st.checkpointPrice)} @ ${formatBkkFromSec(st.checkpointSec)}`,
        `Samples: ${samples.length}`,
      ];
      if (samples.length > 0) {
        lines.push("", ...samples.map((x) => `${formatBkkFromSec(x.tsSec)}  ${formatPriceMaybe(x.lastPrice)}`));
      }
      await sendTelegramMessageToChat(String(chatId), lines.join("\n"), threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] spark log", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `ดึง spark price logs ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] spark log error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const checklist = parsePositionChecklist(normalized);
  if (checklist) {
    try {
      const body = await buildPositionChecklistMessage(checklist);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] position checklist", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `สร้าง checklist ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] checklist error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  console.info("[telegram/webhook] no handler matched", {
    preview: text.slice(0, 80),
    chatId,
  });

  return NextResponse.json({ ok: true });
}

type TelegramWebhookInfoResult = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
};

/** เปิดในเบราว์เซอร์ — สุขภาพ route + ข้อมูลจาก Telegram getWebhookInfo (ช่วยเช็คว่าทำไมบอทไม่ตอบในแชท) */
export async function GET() {
  const base =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  let telegramWebhook: TelegramWebhookInfoResult | null = null;

  if (token) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`,
      );
      const j = (await r.json()) as {
        ok?: boolean;
        result?: TelegramWebhookInfoResult;
      };
      const raw = j?.result;
      if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
        const le = raw.last_error_message;
        telegramWebhook = {
          ...raw,
          last_error_message:
            typeof le === "string" && le.length > 400 ? `${le.slice(0, 400)}…` : le,
        };
      }
    } catch (e) {
      console.error("[telegram/webhook] getWebhookInfo", e);
    }
  }

  return NextResponse.json({
    ok: true,
    service: "telegram_webhook",
    hint: "แจ้งเตือนเข้ากลุ่มใช้แค่ sendMessage — บอทตอบในแชทส่วนตัวต้อง setWebhook ชี้มาที่ webhookUrlExpected (POST)",
    miniAppBaseConfigured: Boolean(base),
    webhookUrlExpected: base ? `${base.replace(/\/$/, "")}/api/telegram/webhook` : null,
    telegramWebhook,
    setWebhookDocs: "https://core.telegram.org/bots/api#setwebhook",
  });
}
