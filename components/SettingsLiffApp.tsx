"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  getTelegramInitData,
  getTelegramMiniAppDisplayName,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

async function readApiResponse(res: Response): Promise<{ text: string; parsed: unknown }> {
  const text = await res.text();
  if (!text) return { text: "", parsed: null };
  try {
    return { text, parsed: JSON.parse(text) as unknown };
  } catch {
    return { text, parsed: null };
  }
}

function messageFromParsed(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
    return String((parsed as { error: unknown }).error);
  }
  return fallback;
}

class ApiRequestError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly url: string;

  constructor(message: string, status: number, bodyText: string, url: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.bodyText = bodyText;
    this.url = url;
  }
}

function ApiDebugBlock({ error }: { error: ApiRequestError }) {
  return (
    <>
      <p className="sub" style={{ marginTop: "0.75rem" }}>
        <strong>HTTP {error.status}</strong>{" "}
        <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>{error.url}</code>
      </p>
      <p className="sub" style={{ marginTop: "0.5rem" }}>
        Response body (ดิบ):
      </p>
      <pre
        style={{
          marginTop: "0.25rem",
          padding: "0.75rem",
          fontSize: "0.72rem",
          overflow: "auto",
          maxHeight: "45vh",
          background: "rgba(0,0,0,0.2)",
          borderRadius: "6px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {error.bodyText.slice(0, 12_000)}
      </pre>
    </>
  );
}

type TmaConfig = {
  mode: string;
  botTokenConfigured: boolean;
};

type Phase = "loading" | "setup" | "ready";

type TradingViewMexcResponse = {
  exchange?: string;
  userId?: string;
  webhookUrl?: string;
  webhookPath?: string;
  webhookToken?: string | null;
  mexcApiKeySet?: boolean;
  mexcApiKeyLast4?: string | null;
  mexcSecretSet?: boolean;
  mexcCredsComplete?: boolean;
  exampleJson?: Record<string, string>;
};

export default function SettingsLiffApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [titleLine, setTitleLine] = useState("ตั้งค่า");
  const [tvSettings, setTvSettings] = useState<TradingViewMexcResponse | null>(null);
  const [tvLoadErr, setTvLoadErr] = useState("");
  const [tvSaveErr, setTvSaveErr] = useState("");
  const [tvSaving, setTvSaving] = useState(false);
  const [mexcKeyInput, setMexcKeyInput] = useState("");
  const [mexcSecretInput, setMexcSecretInput] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadTelegramWebApp();
        prepareTelegramMiniAppShell();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลด Telegram Web App ไม่ได้: {e instanceof Error ? e.message : String(e)}</p>
          );
          setPhase("setup");
        }
        return;
      }

      let cfg: TmaConfig;
      try {
        const configUrl = `${apiBase}/api/tma/config`;
        const res = await fetch(configUrl);
        const { text, parsed } = await readApiResponse(res);
        if (!res.ok) {
          const msg = messageFromParsed(parsed, res.statusText);
          if (!cancelled) {
            setSetupBody(
              <>
                <p>โหลด config ไม่สำเร็จ</p>
                <p className="sub">{msg}</p>
                <ApiDebugBlock error={new ApiRequestError(msg, res.status, text, configUrl)} />
              </>
            );
            setPhase("setup");
          }
          return;
        }
        cfg = parsed as TmaConfig;
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>โหลด config ไม่ได้ — เครือข่ายหรือ URL ผิด</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      if (!cfg.botTokenConfigured) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>ยังไม่ตั้ง TELEGRAM_BOT_TOKEN</strong>
              </p>
              <p className="sub">ใส่ bot token ใน env ของเซิร์ฟเวอร์</p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      const initData = getTelegramInitData();
      if (!initData) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>เปิดหน้านี้จาก Telegram Mini App</strong>
              </p>
              <p className="sub">ตั้ง Web App URL ใน BotFather แล้วเปิดจากแอป Telegram</p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      const name = getTelegramMiniAppDisplayName();
      if (!cancelled) {
        setTitleLine(name ? `ตั้งค่า — ${name}` : "ตั้งค่า — Koji");
        setPhase("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    (async () => {
      const initData = getTelegramInitData();
      if (!initData) return;
      setTvLoadErr("");
      try {
        const url = `${apiBase}/api/tma/trading-view-mexc`;
        const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `tma ${initData}` } });
        const { text, parsed } = await readApiResponse(res);
        if (!res.ok) {
          if (!cancelled) {
            setTvLoadErr(
              messageFromParsed(parsed, res.statusText) + (text ? `\n\nHTTP ${res.status}` : "")
            );
            setTvSettings(null);
          }
          return;
        }
        if (!cancelled) setTvSettings(parsed as TradingViewMexcResponse);
      } catch (e) {
        if (!cancelled) {
          setTvLoadErr(e instanceof Error ? e.message : String(e));
          setTvSettings(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase === "loading") {
    return (
      <div className="card">
        <div className="liffLoading" role="status" aria-live="polite" aria-busy="true">
          <div className="liffLoadingSpinner" aria-hidden />
          <p className="liffLoadingLabel">กำลังโหลด…</p>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return <div className="card">{setupBody}</div>;
  }

  const onSaveTvMexc = async (opts: { rotateToken?: boolean; clearMexc?: boolean }) => {
    setTvSaveErr("");
    const initData = getTelegramInitData();
    if (!initData) {
      setTvSaveErr("ไม่พบ initData");
      return;
    }
    setTvSaving(true);
    try {
      const body: Record<string, unknown> = {
        rotateWebhookToken: Boolean(opts.rotateToken),
        clearMexcCreds: Boolean(opts.clearMexc),
      };
      if (mexcKeyInput.trim()) body.mexcApiKey = mexcKeyInput.trim();
      if (mexcSecretInput.trim()) body.mexcSecret = mexcSecretInput.trim();
      const url = `${apiBase}/api/tma/trading-view-mexc`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `tma ${initData}` },
        body: JSON.stringify(body),
      });
      const { text, parsed } = await readApiResponse(res);
      if (!res.ok) {
        setTvSaveErr(messageFromParsed(parsed, res.statusText) + (text ? ` (${res.status})` : ""));
        return;
      }
      setTvSettings(parsed as TradingViewMexcResponse);
      if (!opts.rotateToken) {
        setMexcKeyInput("");
        setMexcSecretInput("");
      }
      if (opts.clearMexc) {
        setMexcKeyInput("");
        setMexcSecretInput("");
      }
    } catch (e) {
      setTvSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTvSaving(false);
    }
  };

  const exampleJsonText = tvSettings?.exampleJson
    ? JSON.stringify(tvSettings.exampleJson, null, 2)
    : "";

  return (
    <main className="settingsPage">
      <h1>Settings</h1>
      <p className="sub">{titleLine}</p>
      <p className="sub liffQuickNav">
        <Link href="/">หน้าแจ้งเตือน</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/markets">Markets Top 50</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/spark-stats">สถิติ Spark · Matrix</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/upcoming-events">ปฏิทินเหตุการณ์</Link>
      </p>

      <div className="card">
        <h2>System conditions (MEXC)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          แจ้งเตือน funding / รอบชำระ / max order size (สัญญา Top 50) ส่งไปที่{" "}
          <strong>กลุ่ม Telegram</strong> (<code>TELEGRAM_PUBLIC_CHAT_ID</code>
          {", "}
          topic ระบบ: <code>TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID</code>
          {"; "}
          Spark: <code>TELEGRAM_PUBLIC_SPARK_MESSAGE_THREAD_ID</code>
          {"; "}
          เทคนิค: <code>TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID</code>
          {"; "}
          Events weekly: <code>TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID</code>
          {"; "}
          Pre-event: <code>TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID</code>
          {"; "}
          Event result: <code>TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID</code> (หรือ fallback topic เดียวกับ condition)
          {"; "}
          US session: <code>TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID</code> (หรือ fallback weekly)
          {"; "}
          fallback: <code>TELEGRAM_PUBLIC_MESSAGE_THREAD_ID</code>) แบบสาธารณะ — ไม่ต้องเปิดรับรายคนในแอปแล้ว
        </p>
        <p className="sub" style={{ marginTop: "0.75rem" }}>
          รายการเตือนราคา / กลยุทธ์อื่นๆ ยังตั้งได้จากหน้าแรกตามเดิม
        </p>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Auto close (TradingView) — MEXC</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          เมื่อ alert บน TradingView ยิง ระบบจะสั่ง <strong>ปิด position บน MEXC USDT ฟิวเจอร์</strong> สำหรับสัญญา (
          {`symbol`} มาจาก {`{{ticker}}`} ต้อง resolve ได้เป็นคู่ MEXC เช่น{" "}
          <code>BTC_USDT</code> / <code>btc</code> / <code>BINANCE:BTCUSDT.P</code>).
        </p>
        {tvLoadErr ? (
          <p className="sub" style={{ color: "var(--danger, #c44)" }}>
            โหลดการตั้งค่าไม่สำเร็จ: {tvLoadErr}
          </p>
        ) : null}
        {tvSettings ? (
          <>
            <p className="sub" style={{ marginTop: "0.75rem" }}>
              <strong>Exchange</strong> — MEXC (ตัวเลือกเดียวในขั้นนี้)
            </p>
            <p className="sub" style={{ marginTop: "0.5rem" }}>
              <strong>Webhook URL</strong> (ใส่ใน Alert ของ TradingView) —<br />
              <code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{tvSettings.webhookUrl ?? "—"}</code>
            </p>
            <p className="sub" style={{ marginTop: "0.5rem" }}>
              <strong>id</strong> สำหรับ JSON: <code>{tvSettings.userId}</code> (Koji user)
            </p>
            <p className="sub" style={{ marginTop: "0.5rem" }}>
              <strong>Secret ของบอท (webhookToken)</strong> ใช้ใน {`"token"`} — เก็บไว้ อย่าแชร์; รีเซ็ตได้ด้านล่าง
            </p>
            <p className="sub" style={{ marginTop: "0.75rem" }}>
              MEXC: สร้าง API ที่ mexc.com (สิทธิ์ USDT ฟิวเจอร์) — แนะนำผูก IP ของ Vercel / โฮสต์
            </p>
            <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem", maxWidth: "min(32rem, 100%)" }}>
              <label className="sub" style={{ display: "block" }}>
                MEXC API key
                {tvSettings.mexcApiKeySet ? (
                  <span> (ลงท้าย {tvSettings.mexcApiKeyLast4 ?? "****"})</span>
                ) : null}
                <input
                  type="password"
                  style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                  autoComplete="off"
                  value={mexcKeyInput}
                  onChange={(e) => setMexcKeyInput(e.target.value)}
                  placeholder="กรอกเฉพาะเมื่อตั้งหรือเปลี่ยน"
                />
              </label>
              <label className="sub" style={{ display: "block" }}>
                MEXC Secret
                {tvSettings.mexcSecretSet ? <span> (บันทึกแล้ว — กรอกใหม่ถ้าเปลี่ยน)</span> : null}
                <input
                  type="password"
                  style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                  autoComplete="off"
                  value={mexcSecretInput}
                  onChange={(e) => setMexcSecretInput(e.target.value)}
                  placeholder="กรอกเฉพาะเมื่อตั้งหรือเปลี่ยน"
                />
              </label>
            </div>
            <p style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                type="button"
                className="primary"
                style={{ width: "auto", marginTop: 0 }}
                disabled={tvSaving}
                onClick={() => void onSaveTvMexc({})}
              >
                {tvSaving ? "กำลังบันทึก…" : "บันทึก API"}
              </button>
              <button
                type="button"
                className="field"
                style={{ width: "auto", marginTop: 0 }}
                disabled={tvSaving}
                onClick={() => void onSaveTvMexc({ rotateToken: true })}
              >
                สร้าง token ใหม่
              </button>
              <button
                type="button"
                className="danger"
                style={{ width: "auto", marginTop: 0 }}
                disabled={tvSaving}
                onClick={() => void onSaveTvMexc({ clearMexc: true })}
              >
                ลบ MEXC API
              </button>
            </p>
            {tvSaveErr ? (
              <p className="sub" style={{ color: "var(--danger, #c44)" }}>
                {tvSaveErr}
              </p>
            ) : null}
            {tvSettings.mexcCredsComplete ? (
              <p className="sub" style={{ marginTop: "0.5rem", color: "var(--ok, #2a4)" }}>
                MEXC พร้อม: TradingView จะปิด position ผ่าน Webhook ได้
              </p>
            ) : null}
            <h3 className="sub" style={{ marginTop: "1rem", fontWeight: 600 }}>
              Webhook JSON สำหรับวางใน TradingView
            </h3>
            {tvSettings.mexcCredsComplete && exampleJsonText ? (
              <>
                <pre
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.75rem",
                    fontSize: "0.72rem",
                    overflow: "auto",
                    maxHeight: "40vh",
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: "6px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {exampleJsonText}
                </pre>
                <p style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="field"
                    style={{ width: "auto", marginTop: 0 }}
                    onClick={() => {
                      if (exampleJsonText && typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(exampleJsonText);
                      }
                    }}
                  >
                    คัดลอก JSON
                  </button>
                </p>
              </>
            ) : (
              <p className="sub" style={{ marginTop: "0.5rem" }}>
                กรอก MEXC API key และ Secret แล้วกด <strong>บันทึก API</strong> ก่อน — จึงจะแสดง JSON คัดลอกได้ และพิมพ์ขอจากบอทได้
              </p>
            )}
            <p className="sub" style={{ marginTop: "0.5rem" }}>
              หลังตั้ง MEXC แล้ว: <strong>ขอรับ Webhook JSON MEXC</strong> / <strong>ขอรับ webhook json close</strong> / <code>/webhook_json</code> (ปิด) —{" "}
              <strong>ขอรับ Webhook JSON</strong> / <strong>ขอรับ Webhook JSON open</strong> / <code>/webhook_json_open</code> (เปิด — บอทถาม Long/Short, margin, leverage) —{" "}
              <strong>เช็ค MEXC API</strong> / <code>/mexc_api</code>
            </p>
          </>
        ) : tvLoadErr ? null : (
          <p className="sub" style={{ marginTop: "0.75rem" }}>
            กำลังโหลด…
          </p>
        )}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
