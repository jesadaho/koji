"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  snowballStatsGradeLabel,
  snowballStatsVolMetricLabel,
  type SnowballStatsApiPayload,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

const FOOTNOTE =
  "ราคาและ % จาก Binance USDT-M 15m · ATR(100) = Wilder ATR ที่แท่งสัญญาณ · Max Wick(100) = ไส้บนสูงสุดใน 100 แท่งก่อนสัญญาณ (ไม่รวมแท่งสัญญาณ) · Grade LONG: A+=HH48+HH200+VAH · B=VAH · C=HH48 ไม่ผ่าน HH200 · SVP Hole = วอลุ่มแท่งสัญญาณต่ำกว่าเกณฑ์เทียบ SMA · RR ตาม SNOWBALL_STATS_RR_REWARD_SOURCE";

function truncateApiBody(s: string, max = MAX_API_DEBUG_BODY): string {
  if (s.length > max) return `${s.slice(0, max)}\n\n… (ตัดเหลือ ${max} ตัวอักษร)`;
  return s;
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

function coinLabel(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u;
}

function formatBkk(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

function fmtPctCell(price: number | null, pct: number | null): ReactNode {
  if (price == null || !Number.isFinite(price)) return "—";
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtPrice(price)} ({fmtPct(pct)})
    </span>
  );
}

function outcomeLabel(o: SnowballStatsRow["outcome"]): string {
  if (o === "pending") return "Pending";
  if (o === "win_quick_tp30") return "Win (Quick TP30%)";
  if (o === "win_trend") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}

function gradeCellClass(tier: SnowballStatsRow["qualityTier"] | undefined): string {
  if (tier === "a_plus") return "snowGradeCell snowGradeCell--a";
  if (tier === "b_plus") return "snowGradeCell snowGradeCell--b";
  if (tier === "c_plus") return "snowGradeCell snowGradeCell--c";
  return "snowGradeCell";
}

export default function SnowballStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<SnowballStatsApiPayload | null>(null);
  const [loadErr, setLoadErr] = useState("");

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

  const loadStats = useCallback(async () => {
    const data = (await api("/snowball-stats")) as SnowballStatsApiPayload;
    setPayload(data);
    setLoadErr("");
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
              <p>โหลด config ไม่ได้</p>
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
              <p className="sub">ใส่ bot token ใน env เพื่อยืนยัน initData ของ Mini App</p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      try {
        await loadStats();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
          setSetupBody(
            <>
              <p>โหลดสถิติ Snowball ไม่สำเร็จ</p>
              {apiDebugSection(e)}
            </>
          );
          setPhase("setup");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  if (phase === "loading") {
    return (
      <div className="sparkStatsPage sparkStatsPage--wide">
        <div className="tmaLoadingRow">
          <span className="tmaLoadingSpinner" aria-hidden />
          <span className="tmaLoadingLabel">กำลังโหลด…</span>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="sparkStatsPage sparkStatsPage--wide">
        <h1 className="sparkStatsMatrixSectionTitle">
          สถิติ Snowball
          <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
            Snowball alert log
          </span>
        </h1>
        {setupBody}
        {loadErr ? <p className="sub">{loadErr}</p> : null}
        <p className="sub" style={{ marginTop: "1rem" }}>
          <Link href="/">กลับหน้าแรก</Link>
        </p>
      </div>
    );
  }

  const rows = payload?.rows ?? [];

  return (
    <div className="sparkStatsPage sparkStatsPage--wide">
      <h1 className="sparkStatsMatrixSectionTitle">
        สถิติ Snowball
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          Triple-check log · Binance 15m
        </span>
      </h1>

      <p className="tmaQuickNav" style={{ marginTop: "0.75rem" }}>
        <Link href="/">หน้าแรก</Link>
      </p>

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <div className="sparkMatrixScroll">
          <table className="sparkMatrixTable sparkMatrixTable--compact">
            <thead>
              <tr>
                <th scope="col" className="snowStatsStickyCoin">
                  เหรียญ
                </th>
                <th scope="col">ทิศ</th>
                <th scope="col" className="snowStatsStickyGrade">
                  Grade
                </th>
                <th scope="col">เวลา (BKK)</th>
                <th scope="col">Entry</th>
                <th scope="col">ATR(100)</th>
                <th scope="col">Max Wick(100)</th>
                <th scope="col">4h</th>
                <th scope="col">12h</th>
                <th scope="col">24h</th>
                <th scope="col">Max ROI</th>
                <th scope="col">Duration→MFE</th>
                <th scope="col">Max DD</th>
                <th scope="col">SVP Hole</th>
                <th scope="col">RR</th>
                <th scope="col">ผล</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="sub">
                    ยังไม่มีแถว — รอสัญญาณ Snowball ส่งสำเร็จและ SNOWBALL_STATS_ENABLED
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="snowStatsStickyCoin">{coinLabel(r.symbol)}</td>
                    <td>{r.side === "long" ? "Long" : "Short"}</td>
                    <td className={`snowStatsStickyGrade ${gradeCellClass(r.qualityTier)}`}>
                      {snowballStatsGradeLabel(r.side, r.qualityTier)}
                    </td>
                    <td>
                      <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                    </td>
                    <td>{fmtPrice(r.entryPrice)}</td>
                    <td>{snowballStatsVolMetricLabel(r.atr100, r.entryPrice)}</td>
                    <td>{snowballStatsVolMetricLabel(r.maxUpperWick100, r.entryPrice)}</td>
                    <td>{fmtPctCell(r.price4h, r.pct4h)}</td>
                    <td>{fmtPctCell(r.price12h, r.pct12h)}</td>
                    <td>{fmtPctCell(r.price24h, r.pct24h)}</td>
                    <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                    <td>
                      {r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
                        ? `${r.durationToMfeHours.toFixed(2)}h`
                        : "—"}
                    </td>
                    <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                    <td>{r.svpHoleYn}</td>
                    <td>{r.resultRr ?? "—"}</td>
                    <td>{outcomeLabel(r.outcome)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
          {FOOTNOTE}
        </p>
        <p style={{ marginTop: "0.75rem" }}>
          <button type="button" className="sparkStatsRefreshBtn" onClick={() => void loadStats()}>
            รีเฟรช
          </button>
        </p>
      </section>
    </div>
  );
}
