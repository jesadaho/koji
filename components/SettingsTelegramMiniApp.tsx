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
  if (!parsed || typeof parsed !== "object" || parsed === null) return fallback;
  const o = parsed as Record<string, unknown>;
  const parts: string[] = [];
  if ("error" in o && o.error != null) parts.push(String(o.error));
  if (typeof o.hint === "string" && o.hint.trim()) parts.push(o.hint.trim());
  if (typeof o.summaryTh === "string" && o.summaryTh.trim() && o.summaryTh !== o.hint) {
    parts.push(o.summaryTh.trim());
  }
  if (typeof o.mergedDefaultsTh === "string" && o.mergedDefaultsTh.trim()) {
    parts.push(o.mergedDefaultsTh.trim());
  }
  if (Array.isArray(o.detailsTh)) {
    for (const line of o.detailsTh) {
      if (typeof line === "string" && line.trim()) parts.push(line.trim());
    }
  }
  if (parts.length) return parts.join("\n\n");
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

type SparkOrderSideApi = "follow_spark" | "fade_spark" | "long" | "short";

type SparkTierPayload = {
  enabledBand?: boolean;
  marginUsdt?: number;
  leverage?: number;
  tpPct?: number;
};

type SparkAutoTradeApiBundle = {
  enabled?: boolean;
  direction?: string;
  orderSide?: string;
  /** legacy — จาก API เก่า */
  invertSide?: boolean;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpPct?: number | null;
  /** ปิดโพซิชันหลัง Spark เปิดครบ N ชม. (cron ~5 นาที) • null = ปิดฟีเจอร์ */
  timeStopHours?: number | null;
  byVol?: Partial<Record<SparkTierKey, SparkTierPayload | null>> | null;
};

type SnowballAutoTradeApiBundle = {
  enabled?: boolean;
  direction?: string;
  marginUsdt?: number | null;
  leverage?: number | null;
  quickTpEnabled?: boolean;
  quickTpRoiPct?: number | null;
  quickTpMaxHours?: number | null;
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
  snowballAutoTrade?: SnowballAutoTradeApiBundle;
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
  const [sparkOrderSide, setSparkOrderSide] = useState<SparkOrderSideApi>("follow_spark");
  const [sparkMarginDefault, setSparkMarginDefault] = useState("");
  const [sparkLevDefault, setSparkLevDefault] = useState("");
  const [sparkTpDefault, setSparkTpDefault] = useState("");
  /** checkbox = ชม.; เก็บเซิร์ฟเป็น sparkAutoTradeTimeStopHours === 3 */
  const [sparkTimeStop3h, setSparkTimeStop3h] = useState(false);
  type SparkTierForm = { off: boolean };
  const tierEmpty: SparkTierForm = { off: false };
  const [sparkTiers, setSparkTiers] = useState<Record<SparkTierKey, SparkTierForm>>({
    high: { ...tierEmpty },
    mid: { ...tierEmpty },
    low: { ...tierEmpty },
    unknown: { ...tierEmpty },
  });
  const [sparkSaveErr, setSparkSaveErr] = useState("");
  const [sparkSaveOk, setSparkSaveOk] = useState("");
  const [sparkSaving, setSparkSaving] = useState(false);

  const [snowEnabled, setSnowEnabled] = useState(false);
  const [snowDirection, setSnowDirection] = useState<"both" | "long_only" | "short_only">("both");
  const [snowMarginDefault, setSnowMarginDefault] = useState("");
  const [snowLevDefault, setSnowLevDefault] = useState("");
  const [snowQuickTpEnabled, setSnowQuickTpEnabled] = useState(false);
  const [snowQuickTpRoiPct, setSnowQuickTpRoiPct] = useState("");
  const [snowQuickTpMaxHours, setSnowQuickTpMaxHours] = useState("");
  const [snowSaveErr, setSnowSaveErr] = useState("");
  const [snowSaveOk, setSnowSaveOk] = useState("");
  const [snowSaving, setSnowSaving] = useState(false);

  useEffect(() => {
    if (!sparkSaveOk.trim()) return;
    const t = window.setTimeout(() => setSparkSaveOk(""), 6000);
    return () => window.clearTimeout(t);
  }, [sparkSaveOk]);

  useEffect(() => {
    if (!snowSaveOk.trim()) return;
    const t = window.setTimeout(() => setSnowSaveOk(""), 6000);
    return () => window.clearTimeout(t);
  }, [snowSaveOk]);

  /** sync จาก GET — อย่ากระทำเมื่อ user แก้อยู่: ให้ hydrate จาก tvSettings เท่านั้น */
  useEffect(() => {
    const st = tvSettings?.sparkAutoTrade;
    if (!st) return;
    setSparkEnabled(Boolean(st.enabled));
    const dir = typeof st.direction === "string" ? st.direction.trim() : "both";
    setSparkDirection(
      dir === "long_only" || dir === "short_only" ? dir : dir === "long-only" ? "long_only" : dir === "short-only" ? "short_only" : "both"
    );

    let os: SparkOrderSideApi = "follow_spark";
    const sid = typeof st.orderSide === "string" ? st.orderSide.trim().toLowerCase().replace(/-/g, "_") : "";
    if (sid === "follow_spark" || sid === "followspark" || sid === "follow") os = "follow_spark";
    else if (sid === "fade_spark" || sid === "fadespark" || sid === "fade") os = "fade_spark";
    else if (sid === "long") os = "long";
    else if (sid === "short") os = "short";
    else if (st.invertSide) os = "fade_spark";
    setSparkOrderSide(os);
    setSparkMarginDefault(st.marginUsdt != null && Number.isFinite(st.marginUsdt) ? String(st.marginUsdt) : "");
    setSparkLevDefault(st.leverage != null && Number.isFinite(st.leverage) ? String(st.leverage) : "");
    setSparkTpDefault(st.tpPct != null && Number.isFinite(st.tpPct) ? String(st.tpPct) : "");
    const tsh = st.timeStopHours;
    setSparkTimeStop3h(typeof tsh === "number" && Number.isFinite(tsh) && Math.floor(tsh) === 3);

    const nextTiers: Record<SparkTierKey, SparkTierForm> = {
      high: { ...tierEmpty },
      mid: { ...tierEmpty },
      low: { ...tierEmpty },
      unknown: { ...tierEmpty },
    };
    for (const k of ["high", "mid", "low", "unknown"] as SparkTierKey[]) {
      const bv = st.byVol?.[k];
      if (!bv || typeof bv !== "object") nextTiers[k] = { off: false };
      else nextTiers[k] = { off: bv.enabledBand === false };
    }
    setSparkTiers(nextTiers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.sparkAutoTrade]);

  useEffect(() => {
    const st = tvSettings?.snowballAutoTrade;
    if (!st) return;

    setSnowEnabled(Boolean(st.enabled));
    const dir = typeof st.direction === "string" ? st.direction.trim() : "both";
    setSnowDirection(
      dir === "long_only" || dir === "short_only" ? dir : dir === "long-only" ? "long_only" : dir === "short-only" ? "short_only" : "both"
    );
    setSnowMarginDefault(st.marginUsdt != null && Number.isFinite(st.marginUsdt) ? String(st.marginUsdt) : "");
    setSnowLevDefault(st.leverage != null && Number.isFinite(st.leverage) ? String(st.leverage) : "");
    setSnowQuickTpEnabled(Boolean(st.quickTpEnabled));
    setSnowQuickTpRoiPct(st.quickTpRoiPct != null && Number.isFinite(st.quickTpRoiPct) ? String(st.quickTpRoiPct) : "");
    setSnowQuickTpMaxHours(
      st.quickTpMaxHours != null && Number.isFinite(st.quickTpMaxHours) ? String(st.quickTpMaxHours) : ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.snowballAutoTrade]);

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

  /** ทั้ง 4 tier — เก็บเฉพาะ on/off เทียบ default ด้านบน (และล้าง margin/lev/tp ต่อ-tier เก่าหลังบันทึก) */
  const buildSparkByVolPayload = (): Record<string, SparkTierPayload> => {
    const tierKeys: SparkTierKey[] = ["high", "mid", "low", "unknown"];
    const out: Record<string, SparkTierPayload> = {};
    for (const key of tierKeys) {
      out[key] = sparkTiers[key].off ? { enabledBand: false } : { enabledBand: true };
    }
    return out;
  };

  const onSaveSparkAuto = async () => {
    setSparkSaveErr("");
    setSparkSaveOk("");
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
        orderSide: sparkOrderSide,
        marginUsdt: sparkMarginDefault.trim() ? marginDefaultParsed : null,
        leverage: sparkLevDefault.trim() ? levDefaultParsed : null,
        tpPct: sparkTpDefault.trim() ? tpDefaultParsed : null,
        timeStopHours: sparkTimeStop3h ? 3 : null,
        byVol: byVolBuilt,
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
      setSparkSaveOk(
        sparkEnabled
          ? "บันทึกแล้ว · เปิดใช้ Spark auto-open (รันจริงยังต้องใช้ SPARK_AUTOTRADE_ENABLED=1 ฝั่งเซิร์ฟ)"
          : "บันทึกแล้ว · ปิด Spark auto-open"
      );
    } catch (e) {
      setSparkSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSparkSaving(false);
    }
  };

  const onSaveSnowballAuto = async () => {
    setSnowSaveErr("");
    setSnowSaveOk("");
    const initData = getTelegramInitData();
    if (!initData) {
      setSnowSaveErr("ไม่พบ initData");
      return;
    }

    const marginDefaultParsed = snowMarginDefault.trim() ? parseNumRaw(snowMarginDefault) : null;
    const levDefaultParsed = snowLevDefault.trim() ? parseNumRaw(snowLevDefault) : null;
    const quickRoiParsed = snowQuickTpRoiPct.trim() ? parseNumRaw(snowQuickTpRoiPct) : null;
    const quickHoursParsed = snowQuickTpMaxHours.trim() ? parseNumRaw(snowQuickTpMaxHours) : null;

    if (snowMarginDefault.trim() && marginDefaultParsed == null) {
      setSnowSaveErr("Margin default ไม่ใช่ตัวเลข");
      return;
    }
    if (snowLevDefault.trim() && levDefaultParsed == null) {
      setSnowSaveErr("Leverage default ไม่ใช่ตัวเลข");
      return;
    }
    if (snowQuickTpRoiPct.trim() && quickRoiParsed == null) {
      setSnowSaveErr("Quick TP ROI% ไม่ใช่ตัวเลข");
      return;
    }
    if (snowQuickTpMaxHours.trim() && quickHoursParsed == null) {
      setSnowSaveErr("Quick TP ชั่วโมง ไม่ใช่ตัวเลข");
      return;
    }
    if (snowMarginDefault.trim() && marginDefaultParsed != null && marginDefaultParsed <= 0) {
      setSnowSaveErr("Margin default ต้องเป็นเลขบวก");
      return;
    }
    if (snowLevDefault.trim() && levDefaultParsed != null && levDefaultParsed < 1) {
      setSnowSaveErr("Leverage default ต้อง ≥ 1");
      return;
    }
    if (snowQuickTpEnabled) {
      if (quickRoiParsed != null && quickRoiParsed <= 0) {
        setSnowSaveErr("Quick TP ROI% ต้องเป็นเลขบวก");
        return;
      }
      if (quickHoursParsed != null && quickHoursParsed <= 0) {
        setSnowSaveErr("Quick TP ชั่วโมง ต้องเป็นเลขบวก");
        return;
      }
    }

    setSnowSaving(true);
    try {
      const snowballAutoTrade: Record<string, unknown> = {
        enabled: snowEnabled,
        direction: snowDirection,
        marginUsdt: snowMarginDefault.trim() ? marginDefaultParsed : null,
        leverage: snowLevDefault.trim() ? levDefaultParsed : null,
        quickTpEnabled: snowQuickTpEnabled,
        quickTpRoiPct: snowQuickTpRoiPct.trim() ? quickRoiParsed : null,
        quickTpMaxHours: snowQuickTpMaxHours.trim() ? quickHoursParsed : null,
      };
      const body: Record<string, unknown> = {
        rotateWebhookToken: false,
        clearMexcCreds: false,
        snowballAutoTrade,
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
        setSnowSaveErr(messageFromParsed(parsed, res.statusText) + (text ? ` (${res.status})` : ""));
        return;
      }
      setTvSettings(parsed as TradingViewMexcResponse);
      setMexcKeyInput("");
      setMexcSecretInput("");
      setSnowSaveOk(snowEnabled ? "บันทึกแล้ว · เปิดใช้ Snowball auto-open" : "บันทึกแล้ว · ปิด Snowball auto-open");
    } catch (e) {
      setSnowSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSnowSaving(false);
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
        <Link href="/snowball-stats">สถิติ Snowball</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <a href="#spark-auto-open">Spark auto-open</a>
        {" · "}
        <a href="#snowball-auto-open">Snowball auto-open</a>
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
          Snowball: <code>TELEGRAM_PUBLIC_SNOWBALL_MESSAGE_THREAD_ID</code> (ไม่ตั้ง → ใช้ topic เทคนิค)
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

          <label className="sub tmaCheckboxField" style={{ marginTop: "1rem" }}>
            <input type="checkbox" checked={sparkEnabled} onChange={(e) => setSparkEnabled(e.target.checked)} />
            <span className="tmaCheckboxField__text">
              <strong style={{ fontWeight: 600 }}>เปิดใช้ Spark auto-open</strong>
              <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
                (ต้องตั้ง <code>SPARK_AUTOTRADE_ENABLED=1</code> ฝั่งเซิร์ฟเวอร์ด้วย)
              </span>
            </span>
          </label>

          <label className="sub" style={{ display: "block", marginTop: "0.75rem" }}>
            สัญญาณ Spark ที่เข้ากรอง (จาก % เทียบจุดอ้างอิงใน cron)
            <select
              style={{ display: "block", width: "100%", maxWidth: "24rem", marginTop: "0.35rem" }}
              value={sparkDirection}
              onChange={(e) =>
                setSparkDirection(e.target.value as "both" | "long_only" | "short_only")
              }
            >
              <option value="both">ทั้ง Spike เป็นบวกและเป็นลบ</option>
              <option value="long_only">เฉพาะ Spike ขึ้น (เปอร์เซ็นต์เป็น +)</option>
              <option value="short_only">เฉพาะ Spike ลง (เปอร์เซ็นต์เป็น −)</option>
            </select>
          </label>

          <label className="sub" style={{ display: "block", marginTop: "0.75rem" }}>
            ฝั่งออเดอร์ที่สั่งเปิดเมื่อเข้ากรองข้างบน
            <select
              style={{ display: "block", width: "100%", maxWidth: "24rem", marginTop: "0.35rem" }}
              value={sparkOrderSide}
              onChange={(e) => setSparkOrderSide(e.target.value as SparkOrderSideApi)}
            >
              <option value="follow_spark">ตาม Spike — ขึ้น → LONG · ลง → SHORT</option>
              <option value="fade_spark">เข้าสวน — ขึ้น → SHORT · ลง → LONG</option>
              <option value="long">LONG เสมอ (ใช้กับฟิลเตอร์ Spike เป็นบวก/ลบตามที่ต้องการ)</option>
              <option value="short">SHORT เสมอ</option>
            </select>
          </label>

          <p className="sub" style={{ marginTop: "0.85rem", fontWeight: 600 }}>
            Margin / เลเวเรจ / TP (default)
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            ใช้ทุก tier ที่ยังไม่ได้ระงับในรายการด้านล่าง • TP % ประมาณจาก mark ตอนเปิด • ว่าง = ไม่ตั้ง TP
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

          <label
            className="sub tmaCheckboxField"
            style={{ marginTop: "0.85rem", display: "flex", alignItems: "flex-start", gap: "0.5rem" }}
          >
            <input
              type="checkbox"
              checked={sparkTimeStop3h}
              onChange={(e) => setSparkTimeStop3h(e.target.checked)}
            />
            <span className="tmaCheckboxField__text">
              <strong>ปิด position อัตโนมัติเมื่อครบ ~3 ชั่วโมง</strong>
              <span style={{ display: "block", opacity: 0.88, fontSize: "0.92em", marginTop: "0.2rem" }}>
                ใช้กับที่เปิดจาก Spark auto-open เท่านั้น • เซิร์ฟสั่งปิด market (ตามรอบ cron ~5 นาที ไม่ได้เที่ยงวินาที)
                • ถ้า TP จาก MEXC ชนก่อนครบเวลา โพซิชันอาจถูกปิดจาก TP อยู่ดี
              </span>
            </span>
          </label>

          <p className="sub" style={{ marginTop: "1rem", fontWeight: 600 }}>
            ระดับ Vol (24h เทียบ env SPARK_VOL_TIER_* — เหมือน Spark Matrix)
          </p>
          <p className="sub" style={{ marginTop: "0.35rem" }}>
            แต่ละ tier มีแค่ระงับ/ไม่ระงับ — margin / leverage / TP ใช้ชุด default ด้านบน
          </p>
          {(["high", "mid", "low", "unknown"] as SparkTierKey[]).map((key) => (
            <div
              key={key}
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 0.65rem",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.12)",
              }}
            >
              <label className="sub tmaCheckboxField" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={sparkTiers[key].off}
                  onChange={(e) =>
                    setSparkTiers((prev) => ({
                      ...prev,
                      [key]: { off: e.target.checked },
                    }))
                  }
                />
                <span className="tmaCheckboxField__text">
                  <strong>{sparkTierLabelTh(key)}</strong>
                  <span style={{ display: "block", opacity: 0.88, fontSize: "0.92em", marginTop: "0.15rem" }}>
                    ติ๊ก = ไม่ auto-open ใน tier นี้
                  </span>
                </span>
              </label>
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
          {sparkSaveOk && !sparkSaveErr ? (
            <p className="sub" style={{ color: "#2a9d6a", marginTop: "0.5rem" }} role="status">
              {sparkSaveOk}
            </p>
          ) : null}
      </div>

      <div id="snowball-auto-open" className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Snowball auto-open (MEXC)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          เมื่อ <strong>Snowball ส่งสัญญาณสำเร็จ (closed bar)</strong> ระบบสามารถสั่ง MEXC เปิดโพซิชัน{" "}
          <strong>LONG</strong>/<strong>SHORT</strong> (market) ตามสัญญาณ Snowball โดยใช้ราคาแนะนำของบอทเป็นจุดอ้างอิงสำหรับการคำนวณ Quick TP/กติกา 24h.
        </p>
        {tvSettings && !tvSettings.mexcCredsComplete ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            ใส่ MEXC API ด้านบนและกด <strong>บันทึก API</strong> ก่อน — auto-open ถึงจะเรียก MEXC ได้
          </p>
        ) : null}

        <label className="sub tmaCheckboxField" style={{ marginTop: "1rem" }}>
          <input type="checkbox" checked={snowEnabled} onChange={(e) => setSnowEnabled(e.target.checked)} />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>เปิดใช้ Snowball auto-open</strong>
          </span>
        </label>

        <label className="sub" style={{ display: "block", marginTop: "0.75rem" }}>
          สัญญาณ Snowball ที่เข้ากรอง
          <select
            style={{ display: "block", width: "100%", maxWidth: "24rem", marginTop: "0.35rem" }}
            value={snowDirection}
            onChange={(e) => setSnowDirection(e.target.value as "both" | "long_only" | "short_only")}
          >
            <option value="both">ทั้ง LONG และ SHORT</option>
            <option value="long_only">เฉพาะ LONG</option>
            <option value="short_only">เฉพาะ SHORT</option>
          </select>
        </label>

        <p className="sub" style={{ marginTop: "0.85rem", fontWeight: 600 }}>
          Margin / เลเวเรจ (default)
        </p>
        <p className="sub" style={{ marginTop: 0 }}>
          ใช้กับทุกสัญญาณที่เข้ากรอง • เปิด market บน MEXC
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
              value={snowMarginDefault}
              onChange={(e) => setSnowMarginDefault(e.target.value)}
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
              value={snowLevDefault}
              onChange={(e) => setSnowLevDefault(e.target.value)}
            />
          </label>
        </div>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.85rem" }}>
          <input
            type="checkbox"
            checked={snowQuickTpEnabled}
            onChange={(e) => setSnowQuickTpEnabled(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong>Quick TP</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              ถ้า ROI แตะเป้าภายในช่วงเวลาที่ตั้ง ระบบจะพยายามปิด market ทันที (ตามรอบ cron)
            </span>
          </span>
        </label>
        <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.5rem", maxWidth: "min(32rem, 100%)" }}>
          <label className="sub" style={{ display: "block" }}>
            Quick TP ROI% (ดีฟอลต์ 30)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="30"
              value={snowQuickTpRoiPct}
              onChange={(e) => setSnowQuickTpRoiPct(e.target.value)}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            Quick TP max ชั่วโมง (ดีฟอลต์ 4)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="4"
              value={snowQuickTpMaxHours}
              onChange={(e) => setSnowQuickTpMaxHours(e.target.value)}
            />
          </label>
        </div>

        <p className="sub" style={{ marginTop: "0.85rem" }}>
          กติกาเสริม: <strong>ครบ 24 ชั่วโมง</strong> แล้วถ้ายังติดลบและไม่เข้าเกณฑ์ “รันเทรน” ระบบจะพยายามปิด market ทันที
        </p>

        <p style={{ marginTop: "0.95rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="primary"
            style={{ width: "auto", marginTop: 0 }}
            disabled={snowSaving || tvSaving}
            onClick={() => void onSaveSnowballAuto()}
          >
            {snowSaving ? "กำลังบันทึก…" : "บันทึก Snowball auto-open"}
          </button>
        </p>
        {snowSaveErr ? (
          <p className="sub" style={{ color: "var(--danger, #c44)", marginTop: "0.5rem" }}>
            {snowSaveErr}
          </p>
        ) : null}
        {snowSaveOk && !snowSaveErr ? (
          <p className="sub" style={{ color: "#2a9d6a", marginTop: "0.5rem" }} role="status">
            {snowSaveOk}
          </p>
        ) : null}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
