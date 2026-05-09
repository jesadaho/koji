"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import IndicatorCoinPicker from "@/components/IndicatorCoinPicker";
import { formatScore } from "@/src/marketsFormat";
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

/** 401 + เคยส่ง initData แล้ว → รีโหลดเพื่อรับ initData ใหม่จาก Telegram */
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

type PriceAlert = {
  id: string;
  coinId: string;
  direction: "above" | "below";
  targetUsd: number;
};

type PctStepAlert = {
  id: string;
  coinId: string;
  symbolLabel: string;
  stepPct: number;
  mode: "daily_07_bkk" | "trailing";
  createdAt: string;
};

type Phase = "loading" | "setup" | "ready";

type HomeAlertTab = "price" | "change" | "indicators";

type IndicatorAlertRow =
  | {
      id: string;
      symbol: string;
      symbolLabel: string;
      indicatorType: "RSI";
      parameters: { period: number };
      timeframe: "1h" | "4h";
      threshold: number;
      direction: "above" | "below" | "both";
      createdAt: string;
      lastTriggeredAt?: string;
    }
  | {
      id: string;
      symbol: string;
      symbolLabel: string;
      indicatorType: "EMA_CROSS";
      parameters: { fast: number; slow: number };
      timeframe: "1h" | "4h";
      emaCrossKind: "golden" | "death";
      createdAt: string;
      lastTriggeredAt?: string;
    };

const PCT_STEP_PRESET_VALUES = [1, 2, 3, 5, 10] as const;

type VolumeSignalAlertRow = {
  id: string;
  coinId: string;
  symbolLabel: string;
  timeframe: "1h" | "4h";
  createdAt: string;
  minVolRatio?: number;
  minAbsReturnPct?: number;
  lastEvent?: {
    at: string;
    volRatio: number;
    returnPct: number;
    momentumScore: number;
  };
};

export default function TelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [welcome, setWelcome] = useState("MEXC Futures — จัดการแจ้งเตือน");
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [pctAlerts, setPctAlerts] = useState<PctStepAlert[]>([]);

  const [aSymbol, setASymbol] = useState("");
  const [aDir, setADir] = useState<"above" | "below">("above");
  const [aTarget, setATarget] = useState("");
  const [addErr, setAddErr] = useState("");

  const [pctSymbol, setPctSymbol] = useState("");
  /** ค่า select: "1".."10" หรือ "custom" */
  const [pctStepPreset, setPctStepPreset] = useState<string>("2");
  const [pctStepCustom, setPctStepCustom] = useState("");
  const [pctMode, setPctMode] = useState<"daily_07_bkk" | "trailing">("daily_07_bkk");
  const [pctErr, setPctErr] = useState("");
  const [homeAlertTab, setHomeAlertTab] = useState<HomeAlertTab>("price");

  const [volAlerts, setVolAlerts] = useState<VolumeSignalAlertRow[]>([]);
  const [volMeta, setVolMeta] = useState<{
    topSymbols: string[];
    minVolRatio: number;
    minAbsReturnPct: number;
    minAbsMomentum: number;
    minAbsMomentumByTf: { "1h": number; "4h": number };
    cooldownMs: number;
    maxAlertsPerUser: number;
  } | null>(null);
  const [volOptMinRatio, setVolOptMinRatio] = useState("");
  const [volOptMinRet, setVolOptMinRet] = useState("");

  const [techMeta, setTechMeta] = useState<{
    timeframe: string;
    period: number;
    emaDefaults: { fast: number; slow: number };
    maxAlertsPerUser: number;
    cooldownMs: number;
    topSymbols: string[];
  } | null>(null);
  const [techRows, setTechRows] = useState<IndicatorAlertRow[]>([]);
  const [techThreshold, setTechThreshold] = useState("70");

  const [emaFast, setEmaFast] = useState("9");
  const [emaSlow, setEmaSlow] = useState("21");
  const [emaKind, setEmaKind] = useState<"golden" | "death">("golden");

  const [strategyTf, setStrategyTf] = useState<"1h" | "4h">("1h");
  const [enableVol, setEnableVol] = useState(false);
  const [enableRsi, setEnableRsi] = useState(false);
  const [enableEma, setEnableEma] = useState(false);
  const [trackedChips, setTrackedChips] = useState<string[]>([]);
  const [indSettingsErr, setIndSettingsErr] = useState("");
  const [indSettingsSaving, setIndSettingsSaving] = useState(false);
  /** เปิดช่องกรอกตัวเลข — ค่าเริ่มปิด (ประหยัดพื้นที่) */
  const [volAdvancedOpen, setVolAdvancedOpen] = useState(false);
  const [rsiAdvancedOpen, setRsiAdvancedOpen] = useState(false);
  const [emaAdvancedOpen, setEmaAdvancedOpen] = useState(false);

  const combinedTopSymbols = useMemo(() => {
    const s = new Set<string>();
    (volMeta?.topSymbols ?? []).forEach((x) => s.add(x));
    (techMeta?.topSymbols ?? []).forEach((x) => s.add(x));
    return Array.from(s).sort();
  }, [volMeta?.topSymbols, techMeta?.topSymbols]);

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

  const loadMeta = useCallback(async () => {
    const url = `${apiBase}/api/tma/meta`;
    const res = await fetch(url);
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      throw new ApiRequestError(msg, res.status, text, url);
    }
    const data = parsed as { shortcuts?: string[] };
    if (Array.isArray(data.shortcuts)) setShortcuts(data.shortcuts);
  }, []);

  const refreshAlerts = useCallback(async () => {
    const data = (await api("/alerts")) as { alerts?: PriceAlert[] };
    setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
  }, [api]);

  const refreshPctAlerts = useCallback(async () => {
    const data = (await api("/pct-alerts")) as { pctAlerts?: PctStepAlert[] };
    setPctAlerts(Array.isArray(data.pctAlerts) ? data.pctAlerts : []);
  }, [api]);

  const refreshVolMeta = useCallback(async () => {
    const url = `${apiBase}/api/tma/volume-signal-meta`;
    const res = await fetch(url);
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      throw new ApiRequestError(msg, res.status, text, url);
    }
    const data = parsed as {
      topSymbols?: string[];
      minVolRatio?: number;
      minAbsReturnPct?: number;
      minAbsMomentum?: number;
      minAbsMomentumByTf?: { "1h"?: number; "4h"?: number };
      cooldownMs?: number;
      maxAlertsPerUser?: number;
    };
    const byTf = data.minAbsMomentumByTf;
    const minAbsMomentumByTf = {
      "1h": typeof byTf?.["1h"] === "number" ? byTf["1h"] : typeof data.minAbsMomentum === "number" ? data.minAbsMomentum : 0,
      "4h": typeof byTf?.["4h"] === "number" ? byTf["4h"] : typeof data.minAbsMomentum === "number" ? data.minAbsMomentum : 0,
    };
    setVolMeta({
      topSymbols: Array.isArray(data.topSymbols) ? data.topSymbols : [],
      minVolRatio: typeof data.minVolRatio === "number" ? data.minVolRatio : 3,
      minAbsReturnPct: typeof data.minAbsReturnPct === "number" ? data.minAbsReturnPct : 0,
      minAbsMomentum: typeof data.minAbsMomentum === "number" ? data.minAbsMomentum : minAbsMomentumByTf["1h"],
      minAbsMomentumByTf,
      cooldownMs: typeof data.cooldownMs === "number" ? data.cooldownMs : 4 * 3600 * 1000,
      maxAlertsPerUser: typeof data.maxAlertsPerUser === "number" ? data.maxAlertsPerUser : 10,
    });
  }, []);

  const refreshVolAlerts = useCallback(async () => {
    const data = (await api("/volume-signal-alerts")) as { volumeSignalAlerts?: VolumeSignalAlertRow[] };
    setVolAlerts(Array.isArray(data.volumeSignalAlerts) ? data.volumeSignalAlerts : []);
  }, [api]);

  const refreshTechMeta = useCallback(async () => {
    const url = `${apiBase}/api/tma/indicator-meta`;
    const res = await fetch(url);
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      throw new ApiRequestError(msg, res.status, text, url);
    }
    const data = parsed as {
      timeframe?: string;
      period?: number;
      emaDefaults?: { fast?: number; slow?: number };
      maxAlertsPerUser?: number;
      cooldownMs?: number;
      topSymbols?: string[];
    };
    setTechMeta({
      timeframe: data.timeframe ?? "1h",
      period: typeof data.period === "number" ? data.period : 14,
      emaDefaults: {
        fast: typeof data.emaDefaults?.fast === "number" ? data.emaDefaults.fast : 9,
        slow: typeof data.emaDefaults?.slow === "number" ? data.emaDefaults.slow : 21,
      },
      maxAlertsPerUser: typeof data.maxAlertsPerUser === "number" ? data.maxAlertsPerUser : 30,
      cooldownMs: typeof data.cooldownMs === "number" ? data.cooldownMs : 4 * 3600 * 1000,
      topSymbols: Array.isArray(data.topSymbols) ? data.topSymbols : [],
    });
  }, []);

  const refreshTechAlerts = useCallback(async () => {
    const data = (await api("/indicator-alerts")) as { indicatorAlerts?: IndicatorAlertRow[] };
    const list = Array.isArray(data.indicatorAlerts) ? data.indicatorAlerts : [];
    setTechRows(list);
  }, [api]);

  const applyHydrationForTf = useCallback(
    (tf: "1h" | "4h") => {
      const symSet = new Set<string>();
      for (const v of volAlerts) {
        if (v.timeframe === tf) symSet.add(v.coinId);
      }
      for (const r of techRows) {
        if (r.timeframe === tf) symSet.add(r.symbol);
      }
      setTrackedChips(Array.from(symSet).sort());

      const rsiForTf = techRows.filter(
        (r): r is Extract<IndicatorAlertRow, { indicatorType: "RSI" }> =>
          r.indicatorType === "RSI" && r.timeframe === tf
      );
      if (rsiForTf.length > 0) {
        const f = rsiForTf[0]!;
        setTechThreshold(String(f.threshold));
        setEnableRsi(true);
      } else {
        setEnableRsi(false);
      }

      const emaForTf = techRows.filter(
        (r): r is Extract<IndicatorAlertRow, { indicatorType: "EMA_CROSS" }> =>
          r.indicatorType === "EMA_CROSS" && r.timeframe === tf
      );
      if (emaForTf.length > 0) {
        const ex = emaForTf[0]!;
        setEmaFast(String(ex.parameters.fast));
        setEmaSlow(String(ex.parameters.slow));
        setEmaKind(ex.emaCrossKind);
        setEnableEma(true);
      } else {
        setEnableEma(false);
      }

      const volForTf = volAlerts.filter((v) => v.timeframe === tf);
      if (volForTf.length > 0) {
        setEnableVol(true);
        const v0 = volForTf[0]!;
        setVolOptMinRatio(typeof v0.minVolRatio === "number" ? String(v0.minVolRatio) : "");
        setVolOptMinRet(typeof v0.minAbsReturnPct === "number" ? String(v0.minAbsReturnPct) : "");
      } else {
        setEnableVol(false);
        setVolOptMinRatio("");
        setVolOptMinRet("");
      }
    },
    [volAlerts, techRows]
  );

  useEffect(() => {
    applyHydrationForTf(strategyTf);
  }, [strategyTf, volAlerts, techRows, applyHydrationForTf]);

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
              <p className="sub">ใส่ bot token ใน env ของเซิร์ฟเวอร์ (ยืนยัน initData)</p>
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
              <p className="sub">
                ตั้ง Web App URL ใน BotFather แล้วเปิดจากแอป Telegram (Mini App) เท่านั้น
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      const displayName = getTelegramMiniAppDisplayName();
      if (!cancelled) {
        setWelcome(`สวัสดี ${displayName || "Koji"} — MEXC Futures USDT`);
      }

      try {
        await loadMeta();
        await refreshVolMeta();
        await refreshTechMeta();
        await refreshAlerts();
        await refreshPctAlerts();
        await refreshVolAlerts();
        await refreshTechAlerts();
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
                ตรวจ <code>TELEGRAM_BOT_TOKEN</code> ให้ตรงกับบอทที่เปิด Mini App
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
  }, [loadMeta, refreshVolMeta, refreshTechMeta, refreshAlerts, refreshPctAlerts, refreshVolAlerts, refreshTechAlerts]);

  const onAdd = async () => {
    setAddErr("");
    const symbol = aSymbol.trim();
    const target = Number(aTarget);
    if (!symbol || !Number.isFinite(target) || target <= 0) {
      setAddErr("กรอกสัญญาและเป้าราคาให้ครบ");
      return;
    }
    try {
      await api("/alerts", {
        method: "POST",
        body: JSON.stringify({ symbol, direction: aDir, target }),
      });
      setATarget("");
      await refreshAlerts();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setAddErr(
          `${e.message}\n\nHTTP ${e.status} ${e.url}\n\n${truncateApiBody(e.bodyText, 4000)}`
        );
      } else {
        setAddErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("ลบการแจ้งเตือนนี้?")) return;
    try {
      await api(`/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshAlerts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  const onAddPct = async () => {
    setPctErr("");
    const symbol = pctSymbol.trim();
    const step =
      pctStepPreset === "custom"
        ? Number(pctStepCustom.trim())
        : Number(pctStepPreset);
    if (!symbol || !Number.isFinite(step) || step <= 0) {
      setPctErr("กรอกสัญญาและขั้น % ให้ครบ");
      return;
    }
    try {
      await api("/pct-alerts", {
        method: "POST",
        body: JSON.stringify({ symbol, stepPct: step, mode: pctMode }),
      });
      setPctStepPreset("2");
      setPctStepCustom("");
      await refreshPctAlerts();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setPctErr(`${e.message}\n\nHTTP ${e.status}`);
      } else {
        setPctErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    }
  };

  const onDeletePct = async (id: string) => {
    if (!confirm("ลบรายการแจ้งเตือนการเคลื่อนไหวราคานี้?")) return;
    try {
      await api(`/pct-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshPctAlerts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  const onSaveIndicatorSettings = async () => {
    setIndSettingsErr("");
    if (!enableVol && !enableRsi && !enableEma) {
      setIndSettingsErr("เลือกกลยุทธ์อย่างน้อย 1 อย่าง (Vol / RSI / EMA)");
      return;
    }
    if (trackedChips.length === 0) {
      setIndSettingsErr("เพิ่มเหรียญอย่างน้อย 1 รายการ");
      return;
    }
    const th = Number(techThreshold.replace(",", "."));
    if (enableRsi && (!Number.isFinite(th) || th < 1 || th > 99)) {
      setIndSettingsErr("เกณฑ์ RSI ต้องอยู่ระหว่าง 1–99");
      return;
    }
    const fast = Number(emaFast.replace(",", "."));
    const slow = Number(emaSlow.replace(",", "."));
    if (enableEma) {
      if (!Number.isFinite(fast) || !Number.isFinite(slow) || fast < 2 || slow < 3 || fast >= slow) {
        setIndSettingsErr("EMA fast/slow ต้องเป็นตัวเลข โดย fast < slow (เช่น 9 / 21)");
        return;
      }
      if (slow > 200) {
        setIndSettingsErr("slow สูงสุด 200");
        return;
      }
    }

    setIndSettingsSaving(true);
    try {
      if (enableVol) {
        const payload: Record<string, unknown> = { symbols: trackedChips, timeframe: strategyTf };
        const mr = volOptMinRatio.trim();
        if (mr) payload.minVolRatio = Number(mr.replace(",", "."));
        const ar = volOptMinRet.trim();
        if (ar) payload.minAbsReturnPct = Number(ar.replace(",", "."));
        await api("/volume-signal-alerts/sync", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      if (enableRsi) {
        await api("/indicator-alerts", {
          method: "POST",
          body: JSON.stringify({
            kind: "rsi",
            symbols: trackedChips,
            timeframe: strategyTf,
            threshold: th,
            direction: "both",
            period: 14,
          }),
        });
      }
      if (enableEma) {
        await api("/indicator-alerts", {
          method: "POST",
          body: JSON.stringify({
            kind: "ema",
            symbols: trackedChips,
            timeframe: strategyTf,
            fast,
            slow,
            crossKind: emaKind,
          }),
        });
      }
      await refreshVolAlerts();
      await refreshTechAlerts();
      await refreshVolMeta();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setIndSettingsErr(`${e.message}\n\nHTTP ${e.status}`);
      } else {
        setIndSettingsErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    } finally {
      setIndSettingsSaving(false);
    }
  };

  const onDeleteVol = async (id: string) => {
    if (!confirm("ลบการแจ้งเตือน Volume signal นี้?")) return;
    try {
      await api(`/volume-signal-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshVolAlerts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  const onDeleteTech = async (id: string) => {
    if (!confirm("ลบการแจ้งเตือนรายการนี้?")) return;
    try {
      await api(`/indicator-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshTechAlerts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  const applyRsiPresetStandard = () => {
    setTechThreshold("70");
  };

  const applyRsiPresetExtreme = () => {
    setTechThreshold("30");
  };

  const applyEmaPresetDayTrade = () => {
    setEmaFast("9");
    setEmaSlow("21");
  };

  const applyEmaPresetSwing = () => {
    setEmaFast("50");
    setEmaSlow("200");
  };

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

  return (
    <>
      <h1>Koji</h1>
      <p className="sub">{welcome}</p>
      <p className="sub tmaQuickNav">
        <Link href="/markets">Markets</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/spark-stats">สถิติ Spark · Matrix</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/settings">Settings</Link>
      </p>

      <div className="card">
        <div
          className="tmaTabList"
          role="tablist"
          aria-label="ประเภทการแจ้งเตือน"
        >
          <button
            type="button"
            className="tmaTab"
            id="tma-tab-price"
            role="tab"
            aria-selected={homeAlertTab === "price"}
            aria-controls="tma-panel-price"
            tabIndex={homeAlertTab === "price" ? 0 : -1}
            onClick={() => setHomeAlertTab("price")}
          >
            <span>แจ้งเตือนเป้าราคา</span>
            <span className="tmaTabEn">Price Alert</span>
          </button>
          <button
            type="button"
            className="tmaTab"
            id="tma-tab-change"
            role="tab"
            aria-selected={homeAlertTab === "change"}
            aria-controls="tma-panel-change"
            tabIndex={homeAlertTab === "change" ? 0 : -1}
            onClick={() => setHomeAlertTab("change")}
          >
            <span>แจ้งเตือนความเคลื่อนไหว</span>
            <span className="tmaTabEn">Change Alert</span>
          </button>
          <button
            type="button"
            className="tmaTab"
            id="tma-tab-indicators"
            role="tab"
            aria-selected={homeAlertTab === "indicators"}
            aria-controls="tma-panel-indicators"
            tabIndex={homeAlertTab === "indicators" ? 0 : -1}
            onClick={() => setHomeAlertTab("indicators")}
          >
            <span>Indicator Settings</span>
            <span className="tmaTabEn">Vol · RSI · EMA</span>
          </button>
        </div>

        <datalist id="syms">
          {shortcuts.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        {homeAlertTab === "price" ? (
          <div
            className="tmaTabPanel"
            id="tma-panel-price"
            role="tabpanel"
            aria-labelledby="tma-tab-price"
          >
            <h2>เพิ่มการแจ้งเตือน</h2>
            <div className="row">
              <div>
                <label htmlFor="a-symbol">สัญญา / ย่อ</label>
                <input
                  id="a-symbol"
                  list="syms"
                  value={aSymbol}
                  onChange={(e) => setASymbol(e.target.value)}
                  placeholder="eth"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="row cols2">
              <div>
                <label htmlFor="a-dir">ทิศทาง</label>
                <select id="a-dir" value={aDir} onChange={(e) => setADir(e.target.value as "above" | "below")}>
                  <option value="above">ราคาเกิน (≥)</option>
                  <option value="below">ราคาต่ำกว่า (≤)</option>
                </select>
              </div>
              <div>
                <label htmlFor="a-target">
                  เป้า<span className="srOnly"> USDT</span>
                </label>
                <div className="inputSuffixWrap">
                  <input
                    id="a-target"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    placeholder="4000"
                    value={aTarget}
                    onChange={(e) => setATarget(e.target.value)}
                  />
                  <span className="inputSuffix">USDT</span>
                </div>
              </div>
            </div>
            <button type="button" className="primary" onClick={onAdd}>
              บันทึก
            </button>
            {addErr ? (
              <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {addErr}
              </div>
            ) : null}

            <h2 style={{ marginTop: "1.25rem" }}>รายการแจ้งเตือน</h2>
            {alerts.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                ยังไม่มีรายการ
              </p>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="alertItem">
                  <div>
                    <strong>{a.coinId}</strong>
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      {a.direction === "above" ? "≥" : "≤"} {a.targetUsd} USDT
                    </span>
                  </div>
                  <button type="button" className="danger" onClick={() => onDelete(a.id)}>
                    ลบ
                  </button>
                </div>
              ))
            )}
          </div>
        ) : homeAlertTab === "change" ? (
          <div
            className="tmaTabPanel"
            id="tma-panel-change"
            role="tabpanel"
            aria-labelledby="tma-tab-change"
          >
            <h2>แจ้งเตือนการเคลื่อนไหวราคา</h2>
            <p className="sub" style={{ marginTop: 0 }}>
              ทุก x% จาก anchor · รายวัน: 07:00 น. (ไทย) · trailing: เลื่อน anchor หลังแจ้ง — เช็คประมาณทุก 15 นาที
            </p>
            <p className="sub" style={{ marginTop: "0.35rem", fontSize: "0.82rem" }}>
              ดู Funding / รอบ / Max pos แบบแยกคอลัมน์และสีสัญญาณตลาดได้ที่หน้า{" "}
              <Link href="/markets" style={{ color: "var(--accent)", fontWeight: 600 }}>
                Markets
              </Link>
            </p>
            <div className="row">
              <div>
                <label htmlFor="pct-symbol">สัญญา / ย่อ</label>
                <input
                  id="pct-symbol"
                  list="syms"
                  value={pctSymbol}
                  onChange={(e) => setPctSymbol(e.target.value)}
                  placeholder="btc"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="row cols2">
              <div>
                <label htmlFor="pct-step-preset">
                  ขั้น<span className="srOnly"> เปอร์เซ็นต์</span>
                </label>
                <select
                  id="pct-step-preset"
                  value={pctStepPreset}
                  onChange={(e) => setPctStepPreset(e.target.value)}
                >
                  {PCT_STEP_PRESET_VALUES.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}%
                    </option>
                  ))}
                  <option value="custom">กำหนดเอง…</option>
                </select>
                {pctStepPreset === "custom" ? (
                  <div className="inputSuffixWrap" style={{ marginTop: "0.65rem" }}>
                    <label htmlFor="pct-step-custom" className="srOnly">
                      ระบุเปอร์เซ็นต์ (กำหนดเอง)
                    </label>
                    <input
                      id="pct-step-custom"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="เช่น 4.5"
                      title="ตัวเลขเป็นเปอร์เซ็นต์"
                      value={pctStepCustom}
                      onChange={(e) => setPctStepCustom(e.target.value)}
                      autoComplete="off"
                    />
                    <span className="inputSuffix">%</span>
                  </div>
                ) : null}
              </div>
              <div>
                <label htmlFor="pct-mode">โหมด</label>
                <select
                  id="pct-mode"
                  value={pctMode}
                  onChange={(e) => setPctMode(e.target.value as "daily_07_bkk" | "trailing")}
                >
                  <option value="daily_07_bkk">รายวัน (07:00 ไทย)</option>
                  <option value="trailing">Trailing</option>
                </select>
              </div>
            </div>
            <button type="button" className="primary" onClick={onAddPct}>
              เพิ่มรายการ
            </button>
            {pctErr ? (
              <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {pctErr}
              </div>
            ) : null}
            <p className="sub" style={{ marginTop: "1rem", marginBottom: "0.35rem", fontWeight: 600 }}>
              รายการที่ตั้งไว้
            </p>
            {pctAlerts.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                ยังไม่มีรายการ
              </p>
            ) : (
              pctAlerts.map((a) => (
                <div key={a.id} className="alertItem">
                  <div>
                    <strong>{a.coinId}</strong>
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      ทุก {a.stepPct}% · {a.mode === "trailing" ? "trailing" : "รายวัน 07:00"}
                    </span>
                  </div>
                  <button type="button" className="danger" onClick={() => onDeletePct(a.id)}>
                    ลบ
                  </button>
                </div>
              ))
            )}
          </div>
        ) : homeAlertTab === "indicators" ? (
          <div
            className="tmaTabPanel"
            id="tma-panel-indicators"
            role="tabpanel"
            aria-labelledby="tma-tab-indicators"
          >
            <h2 className="indSettingsTitle">Koji — Indicator Settings</h2>
            <div className="indSettingsInfo">
              <p style={{ margin: "0 0 0.5rem" }}>
                ตั้งกลยุทธ์แล้วเลือกเหรียญชุดเดียว · บันทึกครั้งเดียว · เช็คสัญญาณทุก ~15 นาที
              </p>
              {volMeta ? (
                <p style={{ margin: "0 0 0.45rem" }}>
                  <strong>Vol</strong> (Top 30 vol 24h): ratio เริ่มต้น ≥ {volMeta.minVolRatio.toFixed(2)}× · สูงสุด{" "}
                  {volMeta.maxAlertsPerUser} รายการ/คน · cooldown ~{Math.round(volMeta.cooldownMs / 3600000)} ชม.
                  {(volMeta.minAbsMomentumByTf["1h"] > 0 || volMeta.minAbsMomentumByTf["4h"] > 0) && (
                    <>
                      {" "}
                      · |momentum score| ขั้นต่ำ 1h ≥ {formatScore(volMeta.minAbsMomentumByTf["1h"])} · 4h ≥{" "}
                      {formatScore(volMeta.minAbsMomentumByTf["4h"])}
                    </>
                  )}
                </p>
              ) : null}
              {techMeta ? (
                <p style={{ margin: 0 }}>
                  <strong>RSI / EMA</strong>: รวมสูงสุด {techMeta.maxAlertsPerUser} แถว/คน · cooldown ~
                  {Math.round(techMeta.cooldownMs / 3600000)} ชม.
                </p>
              ) : null}
            </div>

            <p className="indSectionTitle">1. เลือกกลยุทธ์ (Strategy)</p>
            <p className="indTfLabel">Timeframe</p>
            <div className="indTfStack" role="group" aria-label="เลือก timeframe">
              <button
                type="button"
                className={`indTfBtn${strategyTf === "1h" ? " indTfBtn--active" : ""}`}
                onClick={() => setStrategyTf("1h")}
              >
                1H
              </button>
              <button
                type="button"
                className={`indTfBtn${strategyTf === "4h" ? " indTfBtn--active" : ""}`}
                onClick={() => setStrategyTf("4h")}
              >
                4H
              </button>
            </div>
            <p className="indTfLabel" style={{ marginTop: "0.15rem" }}>
              Indicators
            </p>
            <div className="indStratStack">
              <div className="indStratCard">
                <label className="indStratCardHead">
                  <input
                    type="checkbox"
                    checked={enableVol}
                    onChange={(e) => {
                      setEnableVol(e.target.checked);
                      if (!e.target.checked) setVolAdvancedOpen(false);
                    }}
                  />
                  <span>Vol signal (Top vol)</span>
                </label>
                {enableVol ? (
                  <div className="indStratCardBody">
                    <p className="indSummaryLine">
                      ใช้เกณฑ์ตามเซิร์ฟเวอร์ — ถ้าไม่เปิด &quot;แก้ไขค่าละเอียด&quot; ระบบใช้ค่าเริ่มของเซิร์ฟเวอร์ (แนะนำ ratio ≥ 3.0× เมื่อ Vol พุ่งเทียบค่าเฉลี่ย · |แท่ง %| แนะนำ 0.5%)
                    </p>
                    <label className="indAdvancedRow">
                      <input
                        type="checkbox"
                        checked={volAdvancedOpen}
                        onChange={(e) => setVolAdvancedOpen(e.target.checked)}
                      />
                      <span className="indAdvancedGear" aria-hidden>
                        ⚙
                      </span>
                      <span>แก้ไขค่าละเอียด</span>
                    </label>
                    {volAdvancedOpen ? (
                      <div className="indParamBlock" style={{ marginTop: "0.65rem" }}>
                        <div className="row cols2" style={{ marginTop: 0 }}>
                          <div>
                            <label htmlFor="ind-vol-ratio">Vol ratio ขั้นต่ำ</label>
                            <input
                              id="ind-vol-ratio"
                              type="text"
                              inputMode="decimal"
                              value={volOptMinRatio}
                              onChange={(e) => setVolOptMinRatio(e.target.value)}
                              placeholder="3.0"
                              autoComplete="off"
                            />
                          </div>
                          <div>
                            <label htmlFor="ind-vol-ret">|แท่ง %| ขั้นต่ำ</label>
                            <input
                              id="ind-vol-ret"
                              type="text"
                              inputMode="decimal"
                              value={volOptMinRet}
                              onChange={(e) => setVolOptMinRet(e.target.value)}
                              placeholder="0.5"
                              autoComplete="off"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="indStratCard">
                <label className="indStratCardHead">
                  <input
                    type="checkbox"
                    checked={enableRsi}
                    onChange={(e) => {
                      setEnableRsi(e.target.checked);
                      if (!e.target.checked) setRsiAdvancedOpen(false);
                    }}
                  />
                  <span>RSI {techMeta?.period ?? 14}</span>
                </label>
                {enableRsi ? (
                  <div className="indStratCardBody">
                    <p className="indSummaryLine">
                      Koji จะเตือนเมื่อ RSI({techMeta?.period ?? 14}) <strong>ข้ามเกณฑ์ {techThreshold}</strong> ทั้งแบบข้ามขึ้นและข้ามลง
                      (ครั้งละทิศทางต่อแท่งปิด) — ปรับตัวเลขจากปุ่มหรือช่องด้านล่าง
                    </p>
                    <div className="indPresetRow">
                      <button type="button" className="indPresetBtn" onClick={applyRsiPresetStandard}>
                        เกณฑ์ 70 (มาตรฐาน)
                      </button>
                      <button type="button" className="indPresetBtn" onClick={applyRsiPresetExtreme}>
                        เกณฑ์ 30 (โซนแรง)
                      </button>
                    </div>
                    <label className="indAdvancedRow">
                      <input
                        type="checkbox"
                        checked={rsiAdvancedOpen}
                        onChange={(e) => setRsiAdvancedOpen(e.target.checked)}
                      />
                      <span className="indAdvancedGear" aria-hidden>
                        ⚙
                      </span>
                      <span>แก้ไขค่าละเอียด</span>
                    </label>
                    {rsiAdvancedOpen ? (
                      <div className="indParamBlock" style={{ marginTop: "0.65rem" }}>
                        <div className="row" style={{ marginTop: 0 }}>
                          <div>
                            <label htmlFor="ind-rsi-th">เกณฑ์ RSI (เตือนทุกครั้งที่ข้าม ทั้งขึ้นและลง)</label>
                            <div className="inputSuffixWrap">
                              <input
                                id="ind-rsi-th"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={99}
                                step={1}
                                value={techThreshold}
                                onChange={(e) => setTechThreshold(e.target.value)}
                                placeholder="70"
                              />
                              <span className="inputSuffix">RSI</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="indStratCard">
                <label className="indStratCardHead">
                  <input
                    type="checkbox"
                    checked={enableEma}
                    onChange={(e) => {
                      setEnableEma(e.target.checked);
                      if (!e.target.checked) setEmaAdvancedOpen(false);
                    }}
                  />
                  <span>EMA Cross</span>
                </label>
                {enableEma ? (
                  <div className="indStratCardBody">
                    <p className="indSummaryLine">
                      {emaKind === "golden" ? "Golden" : "Death"} cross · EMA {emaFast} / {emaSlow} — ค่าเริ่มแนะนำ 9/21 หรือ Swing 50/200
                    </p>
                    <div className="indPresetRow">
                      <button type="button" className="indPresetBtn" onClick={applyEmaPresetDayTrade}>
                        Day Trade (9 / 21)
                      </button>
                      <button type="button" className="indPresetBtn" onClick={applyEmaPresetSwing}>
                        Swing (50 / 200)
                      </button>
                    </div>
                    <label className="indAdvancedRow">
                      <input
                        type="checkbox"
                        checked={emaAdvancedOpen}
                        onChange={(e) => setEmaAdvancedOpen(e.target.checked)}
                      />
                      <span className="indAdvancedGear" aria-hidden>
                        ⚙
                      </span>
                      <span>แก้ไขค่าละเอียด</span>
                    </label>
                    {emaAdvancedOpen ? (
                      <div className="indParamBlock" style={{ marginTop: "0.65rem" }}>
                        <div className="row">
                          <div>
                            <label htmlFor="ind-ema-kind">ประเภท cross</label>
                            <select
                              id="ind-ema-kind"
                              value={emaKind}
                              onChange={(e) => setEmaKind(e.target.value === "death" ? "death" : "golden")}
                            >
                              <option value="golden">Golden</option>
                              <option value="death">Death</option>
                            </select>
                          </div>
                        </div>
                        <div className="row cols2" style={{ marginTop: "0.5rem" }}>
                          <div>
                            <label htmlFor="ind-ema-fast">EMA เร็ว</label>
                            <input
                              id="ind-ema-fast"
                              type="number"
                              inputMode="numeric"
                              min={2}
                              max={199}
                              step={1}
                              value={emaFast}
                              onChange={(e) => setEmaFast(e.target.value)}
                              placeholder="9"
                            />
                          </div>
                          <div>
                            <label htmlFor="ind-ema-slow">EMA ช้า</label>
                            <input
                              id="ind-ema-slow"
                              type="number"
                              inputMode="numeric"
                              min={3}
                              max={200}
                              step={1}
                              value={emaSlow}
                              onChange={(e) => setEmaSlow(e.target.value)}
                              placeholder="21"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <p className="indSectionTitle" style={{ marginTop: "1.15rem" }}>
              2. เหรียญที่กำลังติดตาม (Apply to)
            </p>
            {trackedChips.length > 0 ? (
              <div className="indChipWrap">
                {trackedChips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="indChip"
                    onClick={() => setTrackedChips((c) => c.filter((x) => x !== s))}
                    title="ลบออกจากรายการก่อนบันทึก"
                  >
                    {s}
                    <span className="indChipRemove" aria-hidden>
                      ×
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="indHintEmpty">ยังไม่มีเหรียญ — เลือกจากรายการด้านล่าง</p>
            )}

            <IndicatorCoinPicker
              contracts={trackedChips}
              onContractsChange={(next) => {
                setIndSettingsErr("");
                setTrackedChips(next);
              }}
              topSymbols={combinedTopSymbols}
              volAlerts={volAlerts}
              techRows={techRows}
            />

            <button
              type="button"
              className="primary indSaveBtn"
              disabled={indSettingsSaving}
              onClick={() => void onSaveIndicatorSettings()}
            >
              {indSettingsSaving ? "กำลังบันทึก…" : "บันทึกและเริ่มทำงาน"}
            </button>
            {indSettingsErr ? (
              <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "0.75rem" }}>
                {indSettingsErr}
              </div>
            ) : null}

            <p className="indSavedHead">รายการที่บันทึกแล้ว</p>
            {volAlerts.length === 0 && techRows.length === 0 ? (
              <p className="indHintEmpty" style={{ marginBottom: 0 }}>
                ยังไม่มีรายการ
              </p>
            ) : (
              <>
                {volAlerts.length > 0 ? (
                  <>
                    <p className="indSavedSub">Volume signal</p>
                    {volAlerts.map((a) => (
                      <div key={a.id} className="alertItem">
                        <div>
                          <strong>{a.coinId}</strong>
                          <br />
                          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                            TF {a.timeframe === "4h" ? "4 ชม." : "1 ชม."}
                            {typeof a.minVolRatio === "number" ? ` · Vol≥${a.minVolRatio}×` : ""}
                            {typeof a.minAbsReturnPct === "number" ? ` · |แท่ง|≥${a.minAbsReturnPct}%` : ""}
                          </span>
                          {a.lastEvent ? (
                            <>
                              <br />
                              <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                                ล่าสุด:{" "}
                                {new Date(a.lastEvent.at).toLocaleString("th-TH", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}{" "}
                                · Vol {a.lastEvent.volRatio.toFixed(2)}× · แท่ง {a.lastEvent.returnPct >= 0 ? "+" : ""}
                                {a.lastEvent.returnPct.toFixed(2)}%
                              </span>
                            </>
                          ) : null}
                        </div>
                        <button type="button" className="danger" onClick={() => onDeleteVol(a.id)}>
                          ลบ
                        </button>
                      </div>
                    ))}
                  </>
                ) : null}
                {techRows.length > 0 ? (
                  <>
                    <p className="indSavedSub">RSI / EMA</p>
                    {techRows.map((a) =>
                      a.indicatorType === "RSI" ? (
                        <div key={a.id} className="alertItem">
                          <div>
                            <strong>{a.symbol}</strong>
                            <br />
                            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                              RSI({a.parameters.period}) {a.timeframe === "4h" ? "4h" : "1h"} ·{" "}
                              {a.direction === "both"
                                ? `ข้าม ↑/↓ ที่ ${a.threshold}`
                                : a.direction === "above"
                                  ? `ข้ามขึ้น > ${a.threshold}`
                                  : `ข้ามลง < ${a.threshold}`}
                            </span>
                            {a.lastTriggeredAt ? (
                              <>
                                <br />
                                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                                  แจ้งล่าสุด:{" "}
                                  {new Date(a.lastTriggeredAt).toLocaleString("th-TH", {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <button type="button" className="danger" onClick={() => onDeleteTech(a.id)}>
                            ลบ
                          </button>
                        </div>
                      ) : (
                        <div key={a.id} className="alertItem">
                          <div>
                            <strong>{a.symbol}</strong>
                            <br />
                            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                              EMA {a.parameters.fast}/{a.parameters.slow} · {a.timeframe === "4h" ? "4h" : "1h"} ·{" "}
                              {a.emaCrossKind === "golden" ? "Golden" : "Death"}
                            </span>
                            {a.lastTriggeredAt ? (
                              <>
                                <br />
                                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                                  แจ้งล่าสุด:{" "}
                                  {new Date(a.lastTriggeredAt).toLocaleString("th-TH", {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <button type="button" className="danger" onClick={() => onDeleteTech(a.id)}>
                            ลบ
                          </button>
                        </div>
                      )
                    )}
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
