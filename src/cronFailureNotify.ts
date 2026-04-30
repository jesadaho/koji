import { sendTelegramMessageToChat } from "./telegramAlert";

type StepLike = {
  ok: boolean;
  ms?: number;
  error?: string;
  detail?: string;
};

function trunc(s: string, max = 700): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

function fmtMs(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  return ` (${Math.round(ms)}ms)`;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

export async function notifyCronFailure(opts: {
  scope: string;
  atIso: string;
  durationMs: number;
  steps?: Record<string, StepLike | undefined>;
  error?: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId =
    process.env.TELEGRAM_SYSTEM_ERROR_CHAT_ID?.trim() ||
    process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  if (!token || !chatId) return;
  const threadId = parsePositiveInt(process.env.TELEGRAM_SYSTEM_ERROR_MESSAGE_THREAD_ID);
  const threadOpts = threadId ? { messageThreadId: threadId } : undefined;

  const lines: string[] = [
    "⚠️ Koji cron failed",
    `scope: ${opts.scope}`,
    `at: ${opts.atIso}`,
    `durationMs: ${Math.round(opts.durationMs)}`,
  ];

  if (opts.error?.trim()) {
    lines.push(`error: ${trunc(opts.error)}`);
  }

  const steps = opts.steps;
  if (steps && typeof steps === "object") {
    const failed: Array<[string, StepLike]> = [];
    for (const [k, v] of Object.entries(steps)) {
      if (!v) continue;
      if (v.ok === false) failed.push([k, v]);
    }
    if (failed.length > 0) {
      lines.push("", "failed steps:");
      for (const [k, s] of failed.slice(0, 8)) {
        const err = s.error?.trim() ? ` — ${trunc(s.error)}` : "";
        const det = !err && s.detail?.trim() ? ` — ${trunc(s.detail)}` : "";
        lines.push(`- ${k}${fmtMs(s.ms)}${err || det}`);
      }
      if (failed.length > 8) {
        lines.push(`- (+${failed.length - 8} more)`);
      }
    }
  }

  try {
    await sendTelegramMessageToChat(chatId, lines.join("\n"), threadOpts);
  } catch (e) {
    console.error("[cronFailureNotify] telegram send failed", e);
  }
}

