"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  candleReversalDayOfWeekBkk,
  CANDLE_REVERSAL_MODEL_SHORT_LEGEND,
  candleReversalModelLabel,
  candleReversalModelShortLabel,
  candleReversalOutcomeLabel,
  candleReversalSignalBarTfLabel,
  candleReversalLookbackRankCell,
  candleReversalVolScoreLabel,
  type CandleReversalStatsApiPayload,
} from "@/lib/candleReversalStatsClient";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const FOOTNOTE =
  "Binance USDT-M · Short bias · 1H: follow-up 4h/12h/24h (ปิด 15m) · MFE แท่ง 1H · ผลที่ 24h · 1D: follow-up 1d/3d/7d (ปิด Day) · ผลที่ 7d · ไม่ส่ง Telegram follow-up";

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

function reversalHorizonCells(r: CandleReversalStatsApiPayload["rows"][number]): ReactNode[] {
  const tf = r.signalBarTf ?? "1d";
  if (tf === "1h") {
    return [
      fmtPctCell(r.price4h, r.pct4h),
      fmtPctCell(r.price12h, r.pct12h),
      fmtPctCell(r.price24h, r.pct24h),
    ];
  }
  return [fmtPctCell(r.price1d, r.pct1d), fmtPctCell(r.price3d, r.pct3d), fmtPctCell(r.price7d, r.pct7d)];
}

type Phase = "loading" | "setup" | "ready";

export default function ReversalStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<CandleReversalStatsApiPayload | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const initData = getTelegramInitData();
    const url = `${apiBase}/api/tma${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(initData ? { Authorization: `tma ${initData}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : res.statusText;
      throw new Error(msg);
    }
    return parsed as CandleReversalStatsApiPayload;
  }, []);

  const loadStats = useCallback(async () => {
    const data = await api("/reversal-stats");
    setPayload(data);
    setResetError(null);
  }, [api]);

  const resetStats = useCallback(async () => {
    if (
      !window.confirm(
        "ล้างสถิติ Reversal ทั้งหมด?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้ — แถวในตารางจะหายจนมีสัญญาณใหม่",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetError(null);
    try {
      await api("/reversal-stats", { method: "POST" });
      await loadStats();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetBusy(false);
    }
  }, [api, loadStats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadTelegramWebApp();
        prepareTelegramMiniAppShell();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลด Telegram Web App ไม่ได้: {e instanceof Error ? e.message : String(e)}</p>,
          );
          setPhase("setup");
        }
        return;
      }

      try {
        const configUrl = `${apiBase}/api/tma/config`;
        const res = await fetch(configUrl);
        const cfg = (await res.json()) as { botTokenConfigured?: boolean };
        if (!cfg.botTokenConfigured) {
          if (!cancelled) {
            setSetupBody(<p>ยังไม่ตั้ง TELEGRAM_BOT_TOKEN</p>);
            setPhase("setup");
          }
          return;
        }
        await loadStats();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลดสถิติ Reversal ไม่สำเร็จ: {e instanceof Error ? e.message : String(e)}</p>,
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
        <h1 className="sparkStatsMatrixSectionTitle">สถิติ Reversal</h1>
        {setupBody}
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
        สถิติ Reversal
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          1D + 1H · โดจิ · ทุบ · แดงยาว
        </span>
      </h1>

      <MiniAppStatsNav showHome style={{ marginTop: "0.75rem" }} />

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <div className="sparkMatrixScroll">
          <table className="sparkMatrixTable sparkMatrixTable--compact">
            <thead>
              <tr>
                <th scope="col" title="สัญลักษณ์">
                  เหรียญ
                </th>
                <th scope="col" title="Timeframe แท่งสัญญาณ">
                  TF
                </th>
                <th scope="col" title={CANDLE_REVERSAL_MODEL_SHORT_LEGEND}>
                  Mdl
                </th>
                <th scope="col" title="วันในสัปดาห์ (BKK)">
                  วัน
                </th>
                <th scope="col" title="เวลาแจ้ง (Asia/Bangkok)">
                  BKK
                </th>
                <th scope="col" title="ราคาเข้า">
                  Entry
                </th>
                <th scope="col" title="Retest">
                  Retest
                </th>
                <th scope="col" title="Stop loss">
                  SL
                </th>
                <th scope="col" title="ไส้บน ÷ ช่วงแท่ง">
                  ไส้%
                </th>
                <th scope="col" title="เนื้อ ÷ ช่วงแท่ง">
                  เนื้อ%
                </th>
                <th scope="col" title="อันดับ volume ในรอบ lookback · 1 = สูงสุด">
                  Vol#
                </th>
                <th scope="col" title="อันดับ high ในรอบ lookback · 1 = สูงสุด">
                  Hi#
                </th>
                <th scope="col" title="Range score">
                  Rng
                </th>
                <th scope="col" title="Wick score">
                  Wick
                </th>
                <th scope="col" title="1H: 4h · 1D: 1d">
                  4h/1d
                </th>
                <th scope="col" title="1H: 12h · 1D: 3d">
                  12h/3d
                </th>
                <th scope="col" title="1H: 24h · 1D: 7d">
                  24h/7d
                </th>
                <th scope="col" title="Max ROI ถึง MFE">
                  ROI
                </th>
                <th scope="col" title="Max drawdown ถึง MFE">
                  DD
                </th>
                <th scope="col" title="ผลหลังครบ horizon">
                  ผล
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={20} className="sub">
                    ยังไม่มีแถว — รอสัญญาณ Reversal ส่งสำเร็จ (CANDLE_REVERSAL_1D/1H_ALERTS_ENABLED)
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const horizons = reversalHorizonCells(r);
                  return (
                  <tr key={r.id}>
                    <td>{coinLabel(r.symbol)}</td>
                    <td>{candleReversalSignalBarTfLabel(r.signalBarTf ?? "1d")}</td>
                    <td title={candleReversalModelLabel(r.model)}>
                      {candleReversalModelShortLabel(r.model)}
                    </td>
                    <td>{candleReversalDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}</td>
                    <td>
                      <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                    </td>
                    <td>{fmtPrice(r.entryPrice)}</td>
                    <td>{fmtPrice(r.retestPrice)}</td>
                    <td>{fmtPrice(r.slPrice)}</td>
                    <td>{r.wickRatioPct != null ? `${r.wickRatioPct.toFixed(1)}%` : "—"}</td>
                    <td>{r.bodyPct != null ? `${r.bodyPct.toFixed(1)}%` : "—"}</td>
                    <td>{candleReversalLookbackRankCell(r.volRankInLookback, r.lookbackBars)}</td>
                    <td>{candleReversalLookbackRankCell(r.highRankInLookback, r.lookbackBars)}</td>
                    <td>{candleReversalVolScoreLabel(r.rangeScore)}</td>
                    <td>{candleReversalVolScoreLabel(r.wickScore)}</td>
                    <td>{horizons[0]}</td>
                    <td>{horizons[1]}</td>
                    <td>{horizons[2]}</td>
                    <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                    <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                    <td>{candleReversalOutcomeLabel(r.outcome)}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
          {CANDLE_REVERSAL_MODEL_SHORT_LEGEND}
          <br />
          {FOOTNOTE}
        </p>
        <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="sparkStatsRefreshBtn" onClick={() => void loadStats()}>
            รีเฟรช
          </button>
          {payload?.isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn danger"
              disabled={resetBusy}
              onClick={() => void resetStats()}
            >
              {resetBusy ? "กำลังล้าง…" : "ล้างสถิติ"}
            </button>
          ) : null}
        </p>
        {resetError ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {resetError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
