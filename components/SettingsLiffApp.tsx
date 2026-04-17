"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getTelegramInitData,
  getTelegramMiniAppDisplayName,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

function truncateApiBody(s: string, max = MAX_API_DEBUG_BODY): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n… (ตัดเหลือ ${max} ตัวอักษร)`;
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
        {truncateApiBody(error.bodyText)}
      </pre>
    </>
  );
}

function apiDebugSection(err: unknown): ReactNode {
  if (err instanceof ApiRequestError) {
    return <ApiDebugBlock error={err} />;
  }
  return null;
}

function reloadIfUnauthorized(status: number, hadInitData: boolean): void {
  if (status !== 401 || !hadInitData) return;
  try {
    window.location.reload();
  } catch {
    /* ignore */
  }
}

type TmaConfig = {
  mode: string;
  botTokenConfigured: boolean;
};

type Phase = "loading" | "setup" | "ready";

export default function SettingsLiffApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [titleLine, setTitleLine] = useState("ตั้งค่า");
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [subErr, setSubErr] = useState("");
  const [saving, setSaving] = useState(false);

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const initData = getTelegramInitData();
    const headers: HeadersInit = {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    };
    const url = `${apiBase}/api/tma${path}`;
    const res = await fetch(url, { ...opts, headers });
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      reloadIfUnauthorized(res.status, Boolean(initData));
      throw new ApiRequestError(msg, res.status, text, url);
    }
    return parsed;
  }, []);

  const refreshSubscription = useCallback(async () => {
    const data = (await api("/system-change-subscription")) as { subscribed?: boolean };
    setSubscribed(Boolean(data.subscribed));
  }, [api]);

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
              <p className="sub">
                ตรวจ <code>NEXT_PUBLIC_API_BASE_URL</code> (บน Vercel เว้นว่างเพื่อ same-origin)
              </p>
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
      }

      try {
        await refreshSubscription();
        if (!cancelled) {
          setPhase("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>เรียก API ไม่ได้</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
              {apiDebugSection(e)}
              <p className="sub" style={{ marginTop: "0.75rem" }}>
                ตรวจ <code>TELEGRAM_BOT_TOKEN</code> ตรงกับบอทที่เปิด Mini App
              </p>
              <p className="sub">
                เว้น <code>NEXT_PUBLIC_API_BASE_URL</code> ว่างบน Vercel เพื่อเรียก <code>/api/tma</code> แบบ
                same-origin
              </p>
            </>
          );
          setPhase("setup");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshSubscription]);

  const onToggle = async (next: boolean) => {
    if (saving || subscribed === null) return;
    if (next === subscribed) return;
    setSubErr("");
    setSaving(true);
    try {
      const data = (await api("/system-change-subscription", {
        method: "PUT",
        body: JSON.stringify({ subscribed: next }),
      })) as { subscribed?: boolean };
      setSubscribed(Boolean(data.subscribed));
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setSubErr(
          `${e.message}\n\nHTTP ${e.status} ${e.url}\n\n${truncateApiBody(e.bodyText, 4000)}`
        );
      } else {
        setSubErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  };

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
      </p>

      <div className="card">
        <h2>ติดตาม System conditions (MEXC)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          แจ้งเมื่อ funding rate / รอบชำระ / max order size เปลี่ยน (สัญญา Top 50 |funding|) — เซิร์ฟเวอร์เช็ครายชั่วโมง
          (cron) รอบแรกบันทึกค่าอ้างอิง ยังไม่ส่งแจ้งเตือนจนกว่าค่าจะเปลี่ยนจริงจากรอบก่อน
        </p>
        <p className="sub">
          ยังใช้คำสั่งในแชทได้: <code>ติดตามระบบ</code> / <code>เลิกติดตามระบบ</code> /{" "}
          <code>สถานะติดตามระบบ</code>
        </p>

        {subscribed === null ? (
          <p className="sub liffLoadingRow" role="status" aria-live="polite">
            <span className="liffLoadingSpinner liffLoadingSpinner--sm" aria-hidden />
            <span>กำลังโหลดสถานะ…</span>
          </p>
        ) : (
          <div style={{ marginTop: "1rem" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                cursor: saving ? "wait" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={subscribed}
                disabled={saving}
                onChange={(e) => {
                  void onToggle(e.target.checked);
                }}
              />
              <span>
                <strong>{subscribed ? "เปิดรับแจ้งเตือนอยู่" : "ปิดรับแจ้งเตือน"}</strong>
              </span>
            </label>
          </div>
        )}

        {subErr ? (
          <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "0.75rem" }}>
            {subErr}
          </div>
        ) : null}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
