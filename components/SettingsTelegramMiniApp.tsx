"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { PCT_STEP_PRESET_VALUES } from "@/lib/alertPresets";
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

type SnowballAutoTradeApiBundle = {
  enabled?: boolean;
  qualitySignalLongEnabled?: boolean;
  qualityShortSignalShortEnabled?: boolean;
  sundayAllShortEnabled?: boolean;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpSlEnabled?: boolean;
  tp1PricePct?: number | null;
  tp1PartialPct?: number | null;
  tp2PricePct?: number | null;
  maxHoldHours?: number | null;
};

type ReversalAutoTradeApiBundle = {
  enabled?: boolean;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpSlEnabled?: boolean;
  tp1PricePct?: number | null;
  tp1PartialPct?: number | null;
  tp2PricePct?: number | null;
  maxHoldHours?: number | null;
  gateQualitySignal?: boolean;
  saturdayAllSignalsEnabled?: boolean;
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
  /** false เมื่อเซิร์ฟตั้ง SNOWBALL_AUTOTRADE_ENABLED=0 (kill switch) */
  snowballAutotradeServerEnabled?: boolean;
  snowballAutoTradeNote?: string;
  snowballAutoTrade?: SnowballAutoTradeApiBundle;
  portfolioTrailingAlert?: {
    enabled?: boolean;
    stepPct?: number | null;
  };
  /** false เมื่อเซิร์ฟตั้ง REVERSAL_AUTOTRADE_ENABLED=0 (kill switch) */
  reversalAutotradeServerEnabled?: boolean;
  reversalAutoTradeNote?: string;
  reversalAutoTrade?: ReversalAutoTradeApiBundle;
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

  const [snowEnabled, setSnowEnabled] = useState(false);
  const [snowQualitySignalLong, setSnowQualitySignalLong] = useState(false);
  const [snowQualityShortShort, setSnowQualityShortShort] = useState(false);
  const [snowSundayAllShort, setSnowSundayAllShort] = useState(false);
  const [snowMarginDefault, setSnowMarginDefault] = useState("");
  const [snowLevDefault, setSnowLevDefault] = useState("");
  const [snowTpSlEnabled, setSnowTpSlEnabled] = useState(true);
  const [snowTp1PricePct, setSnowTp1PricePct] = useState("");
  const [snowTp1PartialPct, setSnowTp1PartialPct] = useState("");
  const [snowTp2PricePct, setSnowTp2PricePct] = useState("");
  const [snowMaxHoldHours, setSnowMaxHoldHours] = useState("");
  const [snowSaveErr, setSnowSaveErr] = useState("");
  const [snowSaveOk, setSnowSaveOk] = useState("");
  const [snowSaving, setSnowSaving] = useState(false);

  const [portfolioTrailingEnabled, setPortfolioTrailingEnabled] = useState(false);
  const [portfolioTrailingStepPct, setPortfolioTrailingStepPct] = useState<string>("3");
  const [portfolioTrailingSaveErr, setPortfolioTrailingSaveErr] = useState("");
  const [portfolioTrailingSaveOk, setPortfolioTrailingSaveOk] = useState("");
  const [portfolioTrailingSaving, setPortfolioTrailingSaving] = useState(false);

  const [revEnabled, setRevEnabled] = useState(false);
  const [revMargin, setRevMargin] = useState("");
  const [revLeverage, setRevLeverage] = useState("");
  const [revTpSlEnabled, setRevTpSlEnabled] = useState(true);
  const [revTp1PricePct, setRevTp1PricePct] = useState("");
  const [revTp1PartialPct, setRevTp1PartialPct] = useState("");
  const [revTp2PricePct, setRevTp2PricePct] = useState("");
  const [revMaxHoldHours, setRevMaxHoldHours] = useState("");
  const [revGateQualitySignal, setRevGateQualitySignal] = useState(true);
  const [revSaturdayAllSignals, setRevSaturdayAllSignals] = useState(false);
  const [revSaveErr, setRevSaveErr] = useState("");
  const [revSaveOk, setRevSaveOk] = useState("");
  const [revSaving, setRevSaving] = useState(false);

  useEffect(() => {
    if (!snowSaveOk.trim()) return;
    const t = window.setTimeout(() => setSnowSaveOk(""), 6000);
    return () => window.clearTimeout(t);
  }, [snowSaveOk]);

  useEffect(() => {
    if (!portfolioTrailingSaveOk.trim()) return;
    const t = window.setTimeout(() => setPortfolioTrailingSaveOk(""), 6000);
    return () => window.clearTimeout(t);
  }, [portfolioTrailingSaveOk]);

  useEffect(() => {
    if (!revSaveOk.trim()) return;
    const t = window.setTimeout(() => setRevSaveOk(""), 6000);
    return () => window.clearTimeout(t);
  }, [revSaveOk]);

  useEffect(() => {
    const st = tvSettings?.snowballAutoTrade;
    if (!st) return;

    setSnowEnabled(Boolean(st.enabled));
    setSnowQualitySignalLong(Boolean(st.qualitySignalLongEnabled));
    setSnowQualityShortShort(Boolean(st.qualityShortSignalShortEnabled));
    setSnowSundayAllShort(Boolean(st.sundayAllShortEnabled));
    setSnowMarginDefault(st.marginUsdt != null && Number.isFinite(st.marginUsdt) ? String(st.marginUsdt) : "");
    setSnowLevDefault(st.leverage != null && Number.isFinite(st.leverage) ? String(st.leverage) : "");
    setSnowTpSlEnabled(st.tpSlEnabled !== false);
    setSnowTp1PricePct(st.tp1PricePct != null && Number.isFinite(st.tp1PricePct) ? String(st.tp1PricePct) : "");
    setSnowTp1PartialPct(
      st.tp1PartialPct != null && Number.isFinite(st.tp1PartialPct) ? String(st.tp1PartialPct) : ""
    );
    setSnowTp2PricePct(st.tp2PricePct != null && Number.isFinite(st.tp2PricePct) ? String(st.tp2PricePct) : "");
    setSnowMaxHoldHours(
      st.maxHoldHours != null && Number.isFinite(st.maxHoldHours) ? String(st.maxHoldHours) : ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.snowballAutoTrade]);

  useEffect(() => {
    const st = tvSettings?.portfolioTrailingAlert;
    if (!st) return;
    setPortfolioTrailingEnabled(Boolean(st.enabled));
    const sp = st.stepPct;
    if (sp != null && Number.isFinite(sp) && (PCT_STEP_PRESET_VALUES as readonly number[]).includes(sp)) {
      setPortfolioTrailingStepPct(String(sp));
    } else if (!st.enabled) {
      setPortfolioTrailingStepPct("3");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.portfolioTrailingAlert]);

  useEffect(() => {
    const st = tvSettings?.reversalAutoTrade;
    if (!st) return;
    setRevEnabled(Boolean(st.enabled));
    setRevMargin(st.marginUsdt != null && Number.isFinite(st.marginUsdt) ? String(st.marginUsdt) : "");
    setRevLeverage(st.leverage != null && Number.isFinite(st.leverage) ? String(st.leverage) : "");
    setRevTpSlEnabled(st.tpSlEnabled !== false);
    setRevTp1PricePct(
      st.tp1PricePct != null && Number.isFinite(st.tp1PricePct) ? String(st.tp1PricePct) : ""
    );
    setRevTp1PartialPct(
      st.tp1PartialPct != null && Number.isFinite(st.tp1PartialPct) ? String(st.tp1PartialPct) : ""
    );
    setRevTp2PricePct(
      st.tp2PricePct != null && Number.isFinite(st.tp2PricePct) ? String(st.tp2PricePct) : ""
    );
    setRevMaxHoldHours(
      st.maxHoldHours != null && Number.isFinite(st.maxHoldHours) ? String(st.maxHoldHours) : ""
    );
    setRevGateQualitySignal(st.gateQualitySignal !== false);
    setRevSaturdayAllSignals(Boolean(st.saturdayAllSignalsEnabled));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate เมื่อได้ tvSettings bundle จากเซิร์ฟเวอร์
  }, [tvSettings?.webhookToken, tvSettings?.reversalAutoTrade]);

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

  const parseNumRaw = (s: string): number | null => {
    const n = Number(String(s).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };

  const onSavePortfolioTrailing = async () => {
    setPortfolioTrailingSaveErr("");
    setPortfolioTrailingSaveOk("");
    const initData = getTelegramInitData();
    if (!initData) {
      setPortfolioTrailingSaveErr("ไม่พบ initData");
      return;
    }
    const stepParsed = Number(portfolioTrailingStepPct);
    if (
      portfolioTrailingEnabled &&
      (!(PCT_STEP_PRESET_VALUES as readonly number[]).includes(stepParsed) || !Number.isFinite(stepParsed))
    ) {
      setPortfolioTrailingSaveErr("เลือกเปอร์เซ็นต์จากรายการ");
      return;
    }

    setPortfolioTrailingSaving(true);
    try {
      const body: Record<string, unknown> = {
        rotateWebhookToken: false,
        clearMexcCreds: false,
        portfolioTrailingAlert: {
          enabled: portfolioTrailingEnabled,
          stepPct: portfolioTrailingEnabled ? stepParsed : null,
        },
      };
      const url = `${apiBase}/api/tma/trading-view-mexc`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify(body),
      });
      const { text, parsed } = await readApiResponse(res);
      if (!res.ok) {
        setPortfolioTrailingSaveErr(
          messageFromParsed(parsed, res.statusText) + (text ? ` (${res.status})` : "")
        );
        return;
      }
      setTvSettings(parsed as TradingViewMexcResponse);
      setPortfolioTrailingSaveOk(
        portfolioTrailingEnabled
          ? `บันทึกแล้ว · แจ้งเตือน portfolio trailing ทุก ${stepParsed}%`
          : "บันทึกแล้ว · ปิดแจ้งเตือน portfolio trailing"
      );
    } catch (e) {
      setPortfolioTrailingSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPortfolioTrailingSaving(false);
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
    const tp1Parsed = snowTp1PricePct.trim() ? parseNumRaw(snowTp1PricePct) : null;
    const tp1PartialParsed = snowTp1PartialPct.trim() ? parseNumRaw(snowTp1PartialPct) : null;
    const tp2Parsed = snowTp2PricePct.trim() ? parseNumRaw(snowTp2PricePct) : null;
    const maxHoldParsed = snowMaxHoldHours.trim() ? parseNumRaw(snowMaxHoldHours) : null;

    if (snowMarginDefault.trim() && marginDefaultParsed == null) {
      setSnowSaveErr("Margin default ไม่ใช่ตัวเลข");
      return;
    }
    if (snowLevDefault.trim() && levDefaultParsed == null) {
      setSnowSaveErr("Leverage default ไม่ใช่ตัวเลข");
      return;
    }
    if (snowTp1PricePct.trim() && tp1Parsed == null) {
      setSnowSaveErr("TP1 % ไม่ใช่ตัวเลข");
      return;
    }
    if (snowTp1PartialPct.trim() && tp1PartialParsed == null) {
      setSnowSaveErr("TP1 ปิด % ไม่ใช่ตัวเลข");
      return;
    }
    if (snowTp2PricePct.trim() && tp2Parsed == null) {
      setSnowSaveErr("TP2 % ไม่ใช่ตัวเลข");
      return;
    }
    if (snowMaxHoldHours.trim() && maxHoldParsed == null) {
      setSnowSaveErr("ครบกี่ชม. ไม่ใช่ตัวเลข");
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
    if (snowTp1PricePct.trim() && (tp1Parsed == null || !(tp1Parsed > 0 && tp1Parsed < 100))) {
      setSnowSaveErr("TP1 % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (snowTp1PartialPct.trim() && (tp1PartialParsed == null || !(tp1PartialParsed > 0 && tp1PartialParsed < 100))) {
      setSnowSaveErr("TP1 ปิด % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (snowTp2PricePct.trim() && (tp2Parsed == null || !(tp2Parsed > 0 && tp2Parsed < 100))) {
      setSnowSaveErr("TP2 % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (tp1Parsed != null && tp2Parsed != null && !(tp2Parsed > tp1Parsed)) {
      setSnowSaveErr("TP2 % ต้องมากกว่า TP1 %");
      return;
    }

    setSnowSaving(true);
    try {
      const snowballAutoTrade: Record<string, unknown> = {
        enabled: snowEnabled,
        qualitySignalLongEnabled: snowQualitySignalLong,
        qualityShortSignalShortEnabled: snowQualityShortShort,
        sundayAllShortEnabled: snowSundayAllShort,
        marginUsdt: snowMarginDefault.trim() ? marginDefaultParsed : null,
        leverage: snowLevDefault.trim() ? levDefaultParsed : null,
        tpSlEnabled: snowTpSlEnabled,
        tp1PricePct: snowTp1PricePct.trim() ? tp1Parsed : null,
        tp1PartialPct: snowTp1PartialPct.trim() ? tp1PartialParsed : null,
        tp2PricePct: snowTp2PricePct.trim() ? tp2Parsed : null,
        maxHoldHours: snowMaxHoldHours.trim() ? maxHoldParsed : null,
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

  const onSaveReversalAuto = async () => {
    setRevSaveErr("");
    setRevSaveOk("");
    const initData = getTelegramInitData();
    if (!initData) {
      setRevSaveErr("ไม่พบ initData");
      return;
    }

    const marginParsed = revMargin.trim() ? parseNumRaw(revMargin) : null;
    const levParsed = revLeverage.trim() ? parseNumRaw(revLeverage) : null;
    const tp1Parsed = revTp1PricePct.trim() ? parseNumRaw(revTp1PricePct) : null;
    const tp1PartialParsed = revTp1PartialPct.trim() ? parseNumRaw(revTp1PartialPct) : null;
    const tp2Parsed = revTp2PricePct.trim() ? parseNumRaw(revTp2PricePct) : null;
    const maxHoldParsed = revMaxHoldHours.trim() ? parseNumRaw(revMaxHoldHours) : null;

    if (revMargin.trim() && marginParsed == null) {
      setRevSaveErr("Margin ไม่ใช่ตัวเลข");
      return;
    }
    if (revLeverage.trim() && levParsed == null) {
      setRevSaveErr("Leverage ไม่ใช่ตัวเลข");
      return;
    }
    if (revMargin.trim() && marginParsed != null && marginParsed <= 0) {
      setRevSaveErr("Margin ต้องเป็นเลขบวก");
      return;
    }
    if (revLeverage.trim() && levParsed != null && levParsed < 1) {
      setRevSaveErr("Leverage ต้อง ≥ 1");
      return;
    }
    if (revEnabled) {
      if (!revGateQualitySignal && !revSaturdayAllSignals) {
        setRevSaveErr("เปิดใช้ Quality Signal หรือวันเสาร์ (auto-open ทุกสัญญาณ) ก่อนบันทึก");
        return;
      }
      if (marginParsed == null || marginParsed <= 0) {
        setRevSaveErr("เปิดใช้แล้วต้องระบุ Margin (เลขบวก)");
        return;
      }
      if (levParsed == null || levParsed < 1) {
        setRevSaveErr("เปิดใช้แล้วต้องระบุ Leverage (≥ 1)");
        return;
      }
    }
    if (revTp1PricePct.trim() && (tp1Parsed == null || !(tp1Parsed > 0 && tp1Parsed < 100))) {
      setRevSaveErr("TP1 ราคาดิ่ง % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (revTp1PartialPct.trim() && (tp1PartialParsed == null || !(tp1PartialParsed > 0 && tp1PartialParsed < 100))) {
      setRevSaveErr("TP1 ปิด % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (revTp2PricePct.trim() && (tp2Parsed == null || !(tp2Parsed > 0 && tp2Parsed < 100))) {
      setRevSaveErr("TP2 ราคาดิ่ง % ต้องอยู่ระหว่าง 0–100");
      return;
    }
    if (revMaxHoldHours.trim() && (maxHoldParsed == null || !(maxHoldParsed > 0 && maxHoldParsed <= 720))) {
      setRevSaveErr("ชั่วโมงถือสูงสุดต้อง > 0 และ ≤ 720");
      return;
    }
    if (tp1Parsed != null && tp2Parsed != null && !(tp2Parsed > tp1Parsed)) {
      setRevSaveErr("TP2 ต้องมากกว่า TP1");
      return;
    }

    setRevSaving(true);
    try {
      const reversalAutoTrade: Record<string, unknown> = {
        enabled: revEnabled,
        gateQualitySignal: revGateQualitySignal,
        saturdayAllSignalsEnabled: revSaturdayAllSignals,
        marginUsdt: revMargin.trim() ? marginParsed : null,
        leverage: revLeverage.trim() ? levParsed : null,
        tpSlEnabled: revTpSlEnabled,
        tp1PricePct: revTp1PricePct.trim() ? tp1Parsed : null,
        tp1PartialPct: revTp1PartialPct.trim() ? tp1PartialParsed : null,
        tp2PricePct: revTp2PricePct.trim() ? tp2Parsed : null,
        maxHoldHours: revMaxHoldHours.trim() ? maxHoldParsed : null,
      };
      const body: Record<string, unknown> = {
        rotateWebhookToken: false,
        clearMexcCreds: false,
        reversalAutoTrade,
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
        setRevSaveErr(messageFromParsed(parsed, res.statusText) + (text ? ` (${res.status})` : ""));
        return;
      }
      setTvSettings(parsed as TradingViewMexcResponse);
      setMexcKeyInput("");
      setMexcSecretInput("");
      setRevSaveOk(
        revEnabled
          ? "บันทึกแล้ว · เปิดใช้ Reversal auto-open (SHORT)"
          : "บันทึกแล้ว · ปิด Reversal auto-open"
      );
    } catch (e) {
      setRevSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRevSaving(false);
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
        <Link href="/reversal-stats">Reversal</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <a href="#portfolio-trailing-alert">Portfolio trailing</a>
        {" · "}
        <a href="#snowball-auto-open">Snowball auto-open</a>
        {" · "}
        <a href="#reversal-auto-open">Reversal auto-open</a>
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
          Reversal 1D: <code>TELEGRAM_PUBLIC_REVERSAL_MESSAGE_THREAD_ID</code>
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

      <div id="portfolio-trailing-alert" className="card" style={{ marginTop: "1.25rem" }}>
        <h2>แจ้งเตือนราคา Portfolio (Trailing)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          แจ้งเตือนอัตโนมัติเมื่อราคาเหรียญที่<strong>ถืออยู่ในโพซิชันเปิด</strong>บน MEXC เคลื่อนจากจุดเตือนครั้งล่าสุดครบทุก X% (แบบ trailing) — ตรวจประมาณทุก 5 นาที
        </p>
        {tvSettings && !tvSettings.mexcCredsComplete && portfolioTrailingEnabled ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            ต้องตั้ง MEXC API ด้านบนและกด <strong>บันทึก API</strong> ก่อน — ระบบถึงจะอ่านพอร์ตได้
          </p>
        ) : null}

        <label className="sub tmaCheckboxField" style={{ marginTop: "1rem" }}>
          <input
            type="checkbox"
            checked={portfolioTrailingEnabled}
            onChange={(e) => setPortfolioTrailingEnabled(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>เปิดแจ้งเตือนอัตโนมัติ (Portfolio trailing)</strong>
          </span>
        </label>

        <label className="sub" style={{ display: "block", marginTop: "0.75rem" }}>
          แจ้งทุก (เปอร์เซ็นต์)
          <select
            style={{ display: "block", width: "100%", maxWidth: "24rem", marginTop: "0.35rem" }}
            value={portfolioTrailingStepPct}
            disabled={!portfolioTrailingEnabled}
            onChange={(e) => setPortfolioTrailingStepPct(e.target.value)}
          >
            {PCT_STEP_PRESET_VALUES.map((n) => (
              <option key={n} value={String(n)}>
                {n}%
              </option>
            ))}
          </select>
        </label>

        <p style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="primary"
            style={{ width: "auto", marginTop: 0 }}
            disabled={portfolioTrailingSaving}
            onClick={() => void onSavePortfolioTrailing()}
          >
            {portfolioTrailingSaving ? "กำลังบันทึก…" : "บันทึกการแจ้งเตือน Portfolio"}
          </button>
        </p>
        {portfolioTrailingSaveErr ? (
          <p className="sub" style={{ color: "var(--danger, #c44)" }}>
            {portfolioTrailingSaveErr}
          </p>
        ) : null}
        {portfolioTrailingSaveOk ? (
          <p className="sub" style={{ color: "var(--ok, #2a4)" }}>
            {portfolioTrailingSaveOk}
          </p>
        ) : null}
      </div>

      <div id="snowball-auto-open" className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Snowball auto-open (MEXC)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          เมื่อ <strong>Snowball ส่งสัญญาณสำเร็จ (closed bar)</strong> ระบบสามารถสั่ง MEXC เปิดโพซิชัน market ตามทิศสัญญาณ —{" "}
          ค่าเริ่มต้น <strong>LONG</strong> → Long · <strong>BEAR</strong> → Short · ตัวเลือกด้านล่าง: ✨ Quality Signal → Long · ✨ Quality Short Signal → Short · วันอาทิตย์ → Short ทุกสัญญาณ
        </p>
        <p className="sub" style={{ marginTop: "0.5rem" }}>
          <Link href="/auto-open-history">ดูประวัติ auto-open</Link>
          {" "}
          (สำเร็จ / ข้าม / ล้มเหลว + เหตุผล)
        </p>
        {tvSettings?.snowballAutotradeServerEnabled === false ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            เซิร์ฟเวอร์ปิด Snowball auto-open ฉุกเฉินอยู่ (<code style={{ fontSize: "0.92em" }}>SNOWBALL_AUTOTRADE_ENABLED=0</code> หรือเทียบเท่า) — ลบตัวแปรนี้หรือตั้งเป็น{" "}
            <code style={{ fontSize: "0.92em" }}>1</code>/<code style={{ fontSize: "0.92em" }}>true</code> แล้วรีสตาร์ทแอป
          </p>
        ) : null}
        {tvSettings?.snowballAutoTradeNote ? (
          <p className="sub" style={{ marginTop: "0.65rem", opacity: 0.92 }}>
            {tvSettings.snowballAutoTradeNote}
          </p>
        ) : null}
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

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={snowQualitySignalLong}
            onChange={(e) => setSnowQualitySignalLong(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>✨ Quality Signal → Long</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              สัญญาณที่ตรง matrix ✨ Quality Signal — เขียว <strong>2</strong> วัน · Funding &gt; −0.10% — สั่ง <strong>Long</strong> ทันทีตอนแจ้ง (ไม่รอ confirm · ไม่บล็อก Monitor) · ชนะ Quality Short / วันอาทิตย์
            </span>
          </span>
        </label>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={snowQualityShortShort}
            onChange={(e) => setSnowQualityShortShort(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>✨ Quality Short Signal → Short</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              สัญญาณที่ตรง matrix ✨ Quality Short Signal — เขียว <strong>1</strong> วัน · Vol×SMA &gt; 3× · R% สัญญาณ &gt; 8% — เปิด <strong>Short</strong> บน MEXC · เปิดตัวเลือกนี้แล้วไม่ตรงเกณฑ์จะไม่ auto-open
            </span>
          </span>
        </label>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={snowSundayAllShort}
            onChange={(e) => setSnowSundayAllShort(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>วันอาทิตย์ (เวลาไทย) → Short ทุกสัญญาณ</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              ทุกวันอาทิตย์ตามเวลาไทย (Asia/Bangkok) — สัญญาณ Snowball <strong>LONG</strong> และ <strong>BEAR</strong> เปิด <strong>Short</strong> บน MEXC (LONG จะถูกกลับทิศ · BEAR ยังเป็น Short ตามปกติ)
            </span>
          </span>
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

        <p className="sub" style={{ marginTop: "1.1rem", fontWeight: 600 }}>
          กลยุทธ์ TP/SL (รัน cron tick หลังเปิด Market)
        </p>
        <ul className="sub" style={{ marginTop: "0.35rem", paddingLeft: "1.25rem" }}>
          <li>
            <strong>TP1</strong>: ราคาเคลื่อนในทิศกำไร ≥ <code>TP1 %</code> → ปิด <code>TP1 ปิด %</code> ของ vol และตั้ง MEXC SL บังทุน @ entry (LONG/SHORT)
          </li>
          <li>
            <strong>TP2</strong>: เคลื่อน ≥ <code>TP2 %</code> → ปิดทั้งหมด + ยกเลิก SL plan
          </li>
          <li>
            <strong>ครบ {snowMaxHoldHours.trim() || "48"} ชม.</strong> → ปิดทั้งหมด (force market) + ยกเลิก SL plan
          </li>
          <li>ส่งข้อความ Telegram ทุก action โดยอัตโนมัติ</li>
        </ul>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={snowTpSlEnabled}
            onChange={(e) => setSnowTpSlEnabled(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>เปิดใช้กลยุทธ์ TP/SL</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              ถ้าปิด ระบบจะเปิดโพซิชันตามเกรดอย่างเดียว ไม่ tick TP1/TP2/max hold ให้
            </span>
          </span>
        </label>

        <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.5rem", maxWidth: "min(32rem, 100%)" }}>
          <label className="sub" style={{ display: "block" }}>
            TP1 ราคาเคลื่อน % (default 10)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 10"
              value={snowTp1PricePct}
              onChange={(e) => setSnowTp1PricePct(e.target.value)}
              disabled={!snowTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            TP1 ปิด % ของ vol (default 50)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 50"
              value={snowTp1PartialPct}
              onChange={(e) => setSnowTp1PartialPct(e.target.value)}
              disabled={!snowTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            TP2 ราคาเคลื่อน % (default 25)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 25"
              value={snowTp2PricePct}
              onChange={(e) => setSnowTp2PricePct(e.target.value)}
              disabled={!snowTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            ครบกี่ ชม. → ปิดทั้งหมด (default 48)
            <input
              type="text"
              inputMode="numeric"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 48"
              value={snowMaxHoldHours}
              onChange={(e) => setSnowMaxHoldHours(e.target.value)}
              disabled={!snowTpSlEnabled}
            />
          </label>
        </div>

        <p className="sub" style={{ marginTop: "0.85rem" }}>
          กติกาเสริม: <strong>ครบ 24 ชั่วโมง</strong> แล้วถ้ายังติดลบและไม่เข้าเกณฑ์ “รันเทรน” ระบบจะพยายามปิด market ทันที (แยกจาก max hold ด้านบน)
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

      <div id="reversal-auto-open" className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Reversal auto-open (MEXC) — SHORT</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          เมื่อ <strong>Reversal alert ส่งสำเร็จในกลุ่ม</strong> ระบบจะสั่ง MEXC เปิด <strong>SHORT</strong> เมื่อสัญญาณผ่าน{" "}
          <strong>Quality Signal</strong> (ถ้าเปิด gate ด้านล่าง) · entry แบบ hybrid ตาม <strong>EMA50 บน TF 15m</strong>:
        </p>
        <ul className="sub" style={{ marginTop: "0.35rem", paddingLeft: "1.25rem" }}>
          <li>ราคาตลาดอยู่<strong>เหนือ</strong> EMA50 15m → เปิด <strong>Market SHORT</strong> ทันที</li>
          <li>ราคาตลาดอยู่<strong>ใต้/เท่ากับ</strong> EMA50 15m → ตั้ง <strong>Limit SHORT</strong> ที่ราคา EMA50 (ดักรีเทสต์)</li>
        </ul>
        <p className="sub" style={{ marginTop: "0.5rem" }}>
          <Link href="/auto-open-history">ดูประวัติ auto-open</Link>
        </p>
        {tvSettings?.reversalAutotradeServerEnabled === false ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            เซิร์ฟเวอร์ปิด Reversal auto-open ฉุกเฉินอยู่ (<code style={{ fontSize: "0.92em" }}>REVERSAL_AUTOTRADE_ENABLED=0</code>) — ลบตัวแปรนี้หรือตั้งเป็น{" "}
            <code style={{ fontSize: "0.92em" }}>1</code>/<code style={{ fontSize: "0.92em" }}>true</code> แล้วรีสตาร์ทแอป
          </p>
        ) : null}
        {tvSettings?.reversalAutoTradeNote ? (
          <p className="sub" style={{ marginTop: "0.65rem", opacity: 0.92 }}>
            {tvSettings.reversalAutoTradeNote}
          </p>
        ) : null}
        {tvSettings && !tvSettings.mexcCredsComplete ? (
          <p className="sub" style={{ marginTop: "0.75rem", color: "var(--danger, #c44)" }}>
            ใส่ MEXC API ด้านบนและกด <strong>บันทึก API</strong> ก่อน — auto-open ถึงจะเรียก MEXC ได้
          </p>
        ) : null}

        <label className="sub tmaCheckboxField" style={{ marginTop: "1rem" }}>
          <input type="checkbox" checked={revEnabled} onChange={(e) => setRevEnabled(e.target.checked)} />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>เปิดใช้ Reversal auto-open (SHORT)</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              จำกัด 1 order/เหรียญ/วันไทย (BKK) — กันสั่งซ้ำในเหรียญเดียวกันต่อวัน
            </span>
          </span>
        </label>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.85rem" }}>
          <input
            type="checkbox"
            checked={revGateQualitySignal}
            onChange={(e) => setRevGateQualitySignal(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>Quality Signal</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              เขียว ≥ 1 วัน · Wick ≤ 0.20 · Range &lt; 4.5 (ตรง preset ในสถิติ Reversal)
            </span>
          </span>
        </label>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={revSaturdayAllSignals}
            onChange={(e) => setRevSaturdayAllSignals(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>วันเสาร์ (เวลาไทย) → auto-open ทุกสัญญาณ</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              ทุกวันเสาร์ตามเวลาไทย (Asia/Bangkok) — สัญญาณ Reversal ทุกตัวเปิด <strong>SHORT</strong> บน MEXC โดยไม่กรอง Quality Signal
            </span>
          </span>
        </label>

        <p className="sub" style={{ marginTop: "0.85rem", fontWeight: 600 }}>
          Margin / เลเวเรจ
        </p>
        <p className="sub" style={{ marginTop: 0 }}>
          ใช้กับสัญญาณที่ผ่าน Quality Signal (หรือทุกสัญญาณในวันเสาร์ถ้าเปิดตัวเลือกด้านบน)
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
              value={revMargin}
              onChange={(e) => setRevMargin(e.target.value)}
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
              value={revLeverage}
              onChange={(e) => setRevLeverage(e.target.value)}
            />
          </label>
        </div>

        <p className="sub" style={{ marginTop: "1.1rem", fontWeight: 600 }}>
          กลยุทธ์ TP/SL (รัน cron tick หลังเปิด Market)
        </p>
        <ul className="sub" style={{ marginTop: "0.35rem", paddingLeft: "1.25rem" }}>
          <li><strong>TP1</strong>: ราคาดิ่ง ≥ <code>TP1 %</code> → ปิด <code>TP1 ปิด %</code> ของ vol และตั้ง MEXC SL บังทุน @ entry</li>
          <li><strong>TP2</strong>: ราคาดิ่ง ≥ <code>TP2 %</code> → ปิดทั้งหมด + ยกเลิก SL plan</li>
          <li><strong>ครบ {revMaxHoldHours.trim() || "48"} ชม.</strong> → ปิดทั้งหมด (force market) + ยกเลิก SL plan</li>
          <li>ส่งข้อความ Telegram ทุก action โดยอัตโนมัติ</li>
        </ul>

        <label className="sub tmaCheckboxField" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={revTpSlEnabled}
            onChange={(e) => setRevTpSlEnabled(e.target.checked)}
          />
          <span className="tmaCheckboxField__text">
            <strong style={{ fontWeight: 600 }}>เปิดใช้กลยุทธ์ TP/SL</strong>
            <span style={{ display: "block", opacity: 0.9, fontSize: "0.93em", marginTop: "0.2rem" }}>
              ถ้าปิด ระบบจะเปิด SHORT อย่างเดียว ไม่ tick TP1/TP2/48h ให้
            </span>
          </span>
        </label>

        <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.5rem", maxWidth: "min(32rem, 100%)" }}>
          <label className="sub" style={{ display: "block" }}>
            TP1 ราคาดิ่ง % (default 10)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 10"
              value={revTp1PricePct}
              onChange={(e) => setRevTp1PricePct(e.target.value)}
              disabled={!revTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            TP1 ปิด % ของ vol (default 50)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 50"
              value={revTp1PartialPct}
              onChange={(e) => setRevTp1PartialPct(e.target.value)}
              disabled={!revTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            TP2 ราคาดิ่ง % (default 25)
            <input
              type="text"
              inputMode="decimal"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 25"
              value={revTp2PricePct}
              onChange={(e) => setRevTp2PricePct(e.target.value)}
              disabled={!revTpSlEnabled}
            />
          </label>
          <label className="sub" style={{ display: "block" }}>
            ครบกี่ ชม. → ปิดทั้งหมด (default 48)
            <input
              type="text"
              inputMode="numeric"
              style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              autoComplete="off"
              placeholder="เช่น 48"
              value={revMaxHoldHours}
              onChange={(e) => setRevMaxHoldHours(e.target.value)}
              disabled={!revTpSlEnabled}
            />
          </label>
        </div>

        <p style={{ marginTop: "0.95rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="primary"
            style={{ width: "auto", marginTop: 0 }}
            disabled={revSaving || tvSaving}
            onClick={() => void onSaveReversalAuto()}
          >
            {revSaving ? "กำลังบันทึก…" : "บันทึก Reversal auto-open"}
          </button>
        </p>
        {revSaveErr ? (
          <p className="sub" style={{ color: "var(--danger, #c44)", marginTop: "0.5rem" }}>
            {revSaveErr}
          </p>
        ) : null}
        {revSaveOk && !revSaveErr ? (
          <p className="sub" style={{ color: "#2a9d6a", marginTop: "0.5rem" }} role="status">
            {revSaveOk}
          </p>
        ) : null}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
