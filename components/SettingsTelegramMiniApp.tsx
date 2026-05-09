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

type SparkTierKey = "high" | "mid" | "low" | "unknown";

type SparkTierPayload = {
  enabledBand?: boolean;
  marginUsdt?: number;
  leverage?: number;
  tpPct?: number;
};

type SparkAutoTradeApiBundle = {
  enabled?: boolean;
  direction?: string;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpPct?: number | null;
  byVol?: Partial<Record<SparkTierKey, SparkTierPayload | null>> | null;
};

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
  sparkAutoTradeNote?: string;
  sparkAutoTrade?: SparkAutoTradeApiBundle;
};

export default function SettingsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [titleLine, setTitleLine] = useState("ตั้งค่า");
  const [tvSettings, setTvSettings] = useState<TradingViewMexcResponse | null>(null);
  const [tvLoadErr, setTvLoadErr] = useState("");
  const [tvSaveErr, setTvSaveErr] = useState("");
  const [tvSaving, setTvSaving] = useState(false);
  const [mexcKeyInput, setMexcKeyInput] = useState("");
  const [mexcSecretInput, setMexcSecretInput] = useState("");

  const [sparkEnabled, setSparkEnabled] = useState(false);
  const [sparkDirection, setSparkDirection] = useState<"both" | "long_only" | "short_only">("both");
  const [sparkMarginDefault, setSparkMarginDefault] = useState("");
  const [sparkLevDefault, setSparkLevDefault] = useState("");
  const [sparkTpDefault, setSparkTpDefault] = useState("");
  type SparkTierForm = { off: boolean; margin: string; lev: string; tp: string };
  const tierEmpty: SparkTierForm = { off: false, margin: "", lev: "", tp: "" };
  const [sparkTiers, setSparkTiers] = useState<Record<SparkTierKey, SparkTierForm>>({
    high: { ...tierEmpty },
    mid: { ...tierEmpty },
    low: { ...tierEmpty },
    unknown: { ...tierEmpty },
  });
  const [sparkSaveErr, setSparkSaveErr] = useState("");
  const [sparkSaving, setSparkSaving] = useState(false);

  /** sync จาก GET — อย่ากระทำเมื่อ user แก้อยู่: ให้ hydrate จาก tvSettings เท่านั้น */
  useEffect(() => {
    const st = tvSettings?.sparkAutoTrade;
    if (!st) return;
    setSparkEnabled(Boolean(st.enabled));
    const dir = typeof st.direction === "string" ? st.direction.trim() : "both";
    setSparkDirection(
      dir === "long_only" || dir === "short_only" ? dir : dir === "long-only" ? "long_only" : dir === "short-only" ? "short_only" : "both"
    );
    setSparkMarginDefault(st.marginUsdt != null && Number.isFinite(st.marginUsdt) ? String(st.marginUsdt) : "");
    setSparkLevDefault(st.leverage != null && Number.isFinite(st.leverage) ? String(st.leverage) : "");
    setSparkTpDefault(st.tpPct != null && Number.isFinite(st.tpPct) ? String(st.tpPct) : "");

    const nextTiers: Record<SparkTierKey, SparkTierForm> = {
      high: { ...tierEmpty },
      mid: { ...tierEmpty },
      low: { ...tierEmpty },
      unknown: { ...tierEmpty },
    };
    for (const k of ["high", "mid", "low", "unknown"] as SparkTierKey[]) {
      const bv = st.byVol?.[k];
      if (!bv || typeof bv !== "object") {
        nextTiers[k] = { off: false, margin: "", lev: "", tp: "" };
      } else {
        nextTiers[k] = {
          off: bv.enabledBand === false,
          margin: bv.marginUsdt != null ? String(bv.marginUsdt) : "",
          lev: bv.leverage != null ? String(bv.leverage) : "",
          tp: bv.tpPct != null ? String(bv.tpPct) : "",
        };
      }
    }
    setSparkTiers(nextTiers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.sparkAutoTrade]);

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
        <div className="tmaLoading" role="status" aria-live="polite" aria-busy="true">
          <div className="tmaLoadingSpinner" aria-hidden />
          <p className="tmaLoadingLabel">กำลังโหลด…</p>
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

  const sparkTierLabelTh = (key: SparkTierKey): string => {
    if (key === "high") return "Vol สูง";
    if (key === "mid") return "Vol กลาง";
    if (key === "low") return "Vol ต่ำ";
    return "Vol ไม่ระบุ";
  };

  const parseNumRaw = (s: string): number | null => {
    const n = Number(String(s).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };

  const buildSparkByVolPayload = (): Record<string, SparkTierPayload> | null => {
    const tierKeys: SparkTierKey[] = ["high", "mid", "low", "unknown"];
    const out: Record<string, SparkTierPayload> = {};
    for (const key of tierKeys) {
      const t = sparkTiers[key];
      const entry: SparkTierPayload = {};
      if (t.off) entry.enabledBand = false;
      const om = parseNumRaw(t.margin);
      const ol = parseNumRaw(t.lev);
      const op = parseNumRaw(t.tp);
      if (om != null && om >= 0) entry.marginUsdt = om;
      if (ol != null && ol >= 1) entry.leverage = Math.floor(ol);
      if (op != null && op >= 0) entry.tpPct = op;
      if (Object.keys(entry).length === 0) continue;
      out[key] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  const onSaveSparkAuto = async () => {
    setSparkSaveErr("");
    const initData = getTelegramInitData();
    if (!initData) {
      setSparkSaveErr("ไม่พบ initData");
      return;
    }
    const marginDefaultParsed = sparkMarginDefault.trim() ? parseNumRaw(sparkMarginDefault) : null;
    const levDefaultParsed = sparkLevDefault.trim() ? parseNumRaw(sparkLevDefault) : null;
    const tpDefaultParsed = sparkTpDefault.trim() ? parseNumRaw(sparkTpDefault) : null;
    if (sparkMarginDefault.trim() && marginDefaultParsed == null) {
      setSparkSaveErr("Margin default ไม่ใช่ตัวเลข");
      return;
    }
    if (sparkLevDefault.trim() && levDefaultParsed == null) {
      setSparkSaveErr("Leverage default ไม่ใช่ตัวเลข");
      return;
    }
    if (sparkTpDefault.trim() && tpDefaultParsed == null) {
      setSparkSaveErr("TP % default ไม่ใช่ตัวเลข");
      return;
    }
    if (sparkMarginDefault.trim() && marginDefaultParsed != null && marginDefaultParsed <= 0) {
      setSparkSaveErr("Margin default ต้องเป็นเลขบวก");
      return;
    }
    if (sparkLevDefault.trim() && levDefaultParsed != null && levDefaultParsed < 1) {
      setSparkSaveErr("Leverage default ต้อง ≥ 1");
      return;
    }

    setSparkSaving(true);
    try {
      const byVolBuilt = buildSparkByVolPayload();
      const sparkAutoTrade: Record<string, unknown> = {
        enabled: sparkEnabled,
        direction: sparkDirection,
        marginUsdt: sparkMarginDefault.trim() ? marginDefaultParsed : null,
        leverage: sparkLevDefault.trim() ? levDefaultParsed : null,
        tpPct: sparkTpDefault.trim() ? tpDefaultParsed : null,
        ...(byVolBuilt ? { byVol: byVolBuilt } : {}),
      };
      const body: Record<string, unknown> = {
        rotateWebhookToken: false,
        clearMexcCreds: false,
        sparkAutoTrade,
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
        setSparkSaveErr(messageFromParsed(parsed, res.statusText) + (text ? ` (${res.status})` : ""));
        return;
      }
      setTvSettings(parsed as TradingViewMexcResponse);
      setMexcKeyInput("");
      setMexcSecretInput("");
    } catch (e) {
      setSparkSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSparkSaving(false);
    }
  };

  const exampleJsonText = tvSettings?.exampleJson
    ? JSON.stringify(tvSettings.exampleJson, null, 2)
    : "";

  return (
    <main className="settingsPage">
      <h1>Settings</h1>
      <p className="sub">{titleLine}</p>
      <p className="sub tmaQuickNav">
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
        <a href="#spark-auto-open">Spark auto-open</a>
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
          topic ระบบ / basis: <code>TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID</code>
          {"; "}
          Market Pulse: <code>TELEGRAM_PUBLIC_MARKET_PULSE_MESSAGE_THREAD_ID</code>
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

      <div id="spark-auto-open" className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Spark auto-open (MEXC)</h2>
        {!tvSettings && tvLoadErr ? (
          <p className="sub" style={{ marginTop: 0, color: "var(--danger, #c44)" }}>
            โหลดโปรไฟล์ MEXC / TradingView ด้านบนไม่สำเร็จ — ตั้งค่า Spark ด้านล่างยังเห็นและยังบันทึกได้เมื่อเข้ามาผ่าน Mini App
          </p>
        ) : !tvSettings ? (
          <p className="sub" style={{ marginTop: 0, opacity: 0.9 }}>
            กำลังโหลดโปรไฟล์…
          </p>
        ) : null}
        <p className="sub" style={{ marginTop: 0 }}>
          เมื่อ <strong>แจ้งเตือน Spark ในกลุ่มส่งสำเร็จ</strong> ระบบสามารถสั่ง MEXC เปิดโพซิชัน{" "}
          <strong>long</strong>/<strong>short</strong> (market) ตามทิศ Spark ใน universe เดียวกับ Cron (Top vol ตาม env) — เก็บ MEXC key ที่ส่วนด้านบน · เฉพาะ{" "}
          <strong>
            user Telegram <code>{tvSettings?.userId ?? "โหลดยังไม่สำเร็จ — เข้ามาผ่าน Mini App"}</code>
          </strong>{" "}
          เท่านั้น · จำกัด <strong>สั่งเปิดได้สำเร็จอย่างมากครั้งหนึ่งต่อเหรียญต่อวันไทย</strong>.
        </p>
        {tvSettings?.sparkAutoTradeNote ? (
          <p className="sub" style={{ marginTop: "0.5rem", opacity: 0.92 }}>
            {tvSettings.sparkAutoTradeNote}
          </p>
        ) : null}
        {tvSettings && !tvSettings.mexcCredsComplete ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            ใส่ MEXC API ด้านบนและกด <strong>บันทึก API</strong> ก่อน — auto-open ถึงจะเรียก MEXC ได้
          </p>
        ) : null}

          <label className="sub" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={sparkEnabled} onChange={(e) => setSparkEnabled(e.target.checked)} />
            เปิดใช้ Spark auto-open (ต้องตั้ง <code>SPARK_AUTOTRADE_ENABLED=1</code> ฝั่งเซิร์ฟเวอร์ด้วย)
          </label>

          <label className="sub" style={{ display: "block", marginTop: "0.75rem" }}>
            ทิศทางที่ยอมรับของคุณ
            <select
              style={{ display: "block", width: "100%", maxWidth: "20rem", marginTop: "0.35rem" }}
              value={sparkDirection}
              onChange={(e) =>
                setSparkDirection(e.target.value as "both" | "long_only" | "short_only")
              }
            >
              <option value="both">ขึ้นและลง (long + short)</option>
              <option value="long_only">ขึ้นอย่างเดียว (long)</option>
              <option value="short_only">ลงอย่างเดียว (short)</option>
            </select>
          </label>

          <p className="sub" style={{ marginTop: "0.85rem", fontWeight: 600 }}>
            Margin / เลเวเรจ / TP (default)
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            ใช้เมื่อช่องใน Vol tier ว่างไว้ • TP % จากราคาโดยประมาณที่ประกบกับฟีดของ MEXC ตอนส่งคำสั่งเปิด • ว่างหมายถึงไม่ตั้ง TP
          </p>
          <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.5rem", maxWidth: "min(32rem, 100%)" }}>
            <label className="sub" style={{ display: "block" }}>
              Margin (USDT)
              <input
                type="text"
                inputMode="decimal"
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                autoComplete="off"
                placeholder="เช่น 100"
                value={sparkMarginDefault}
                onChange={(e) => setSparkMarginDefault(e.target.value)}
              />
            </label>
            <label className="sub" style={{ display: "block" }}>
              Leverage
              <input
                type="text"
                inputMode="numeric"
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                autoComplete="off"
                placeholder="เช่น 10"
                value={sparkLevDefault}
                onChange={(e) => setSparkLevDefault(e.target.value)}
              />
            </label>
            <label className="sub" style={{ display: "block" }}>
              TP (% เป้า)
              <input
                type="text"
                inputMode="decimal"
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                autoComplete="off"
                placeholder="เช่น 2 · ว่าง = ปิด TP"
                value={sparkTpDefault}
                onChange={(e) => setSparkTpDefault(e.target.value)}
              />
            </label>
          </div>

          <p className="sub" style={{ marginTop: "1rem", fontWeight: 600 }}>
            ปรับตามระดับ Vol (24h เทียบ env SPARK_VOL_TIER_* — เหมือนหมวดใน Spark Matrix)
          </p>
          {(["high", "mid", "low", "unknown"] as SparkTierKey[]).map((key) => (
            <div
              key={key}
              style={{
                marginTop: "0.65rem",
                padding: "0.65rem 0.75rem",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.12)",
              }}
            >
              <strong className="sub">{sparkTierLabelTh(key)}</strong>
              <label className="sub" style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.35rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={sparkTiers[key].off}
                  onChange={(e) =>
                    setSparkTiers((prev) => ({
                      ...prev,
                      [key]: { ...prev[key], off: e.target.checked },
                    }))
                  }
                />
                ปิด tier นี้จากการ auto-open เลย (เล่นทั้งหมดยกเว้นที่ติ๊ก)
              </label>
              <div style={{ marginTop: "0.35rem", display: "grid", gap: "0.35rem", gridTemplateColumns: "1fr", maxWidth: "28rem" }}>
                <label className="sub" style={{ margin: 0 }}>
                  Margin (ถ้าว่าง = ใช้ default)
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ display: "block", width: "100%", marginTop: "0.2rem" }}
                    autoComplete="off"
                    placeholder="ว่างใช้ default"
                    value={sparkTiers[key].margin}
                    onChange={(e) =>
                      setSparkTiers((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], margin: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="sub" style={{ margin: 0 }}>
                  Leverage
                  <input
                    type="text"
                    inputMode="numeric"
                    style={{ display: "block", width: "100%", marginTop: "0.2rem" }}
                    autoComplete="off"
                    placeholder="ว่างใช้ default"
                    value={sparkTiers[key].lev}
                    onChange={(e) =>
                      setSparkTiers((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], lev: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="sub" style={{ margin: 0 }}>
                  TP %
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ display: "block", width: "100%", marginTop: "0.2rem" }}
                    autoComplete="off"
                    placeholder="ว่างใช้ default · ว่างใน default และที่นี่ด้วย =ไม่มี TP"
                    value={sparkTiers[key].tp}
                    onChange={(e) =>
                      setSparkTiers((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], tp: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          ))}

          <p style={{ marginTop: "0.95rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              type="button"
              className="primary"
              style={{ width: "auto", marginTop: 0 }}
              disabled={sparkSaving || tvSaving}
              onClick={() => void onSaveSparkAuto()}
            >
              {sparkSaving ? "กำลังบันทึก…" : "บันทึก Spark auto-open"}
            </button>
          </p>
          {sparkSaveErr ? (
            <p className="sub" style={{ color: "var(--danger, #c44)", marginTop: "0.5rem" }}>
              {sparkSaveErr}
            </p>
          ) : null}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
