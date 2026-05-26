"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  snowballHorizonWinrateSummary,
  snowballStatsBarRangePctLabel,
  snowballStatsConfirmVolRankLabel,
  snowballStatsConfirmVolVsSmaLabel,
  snowballStatsVolVsSmaDisplay,
  snowballStatsDayOfWeekBkk,
  snowballStatsHorizonDue,
  snowballStatsBtcPsarCombinedLabel,
  snowballStatsGradeCellClass,
  snowballGradeChecklistMark,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsStagedPopupText,
  snowballStatsGradeDisplayLabel,
  snowballStatsGreenDaysLabel,
  snowballStatsSideLabel,
  snowballStatsFundingRateLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsVolScoreLabel,
  snowballStatsVolumeCascadeLabel,
  type SnowballStatsApiPayload,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import { snowballStatsToCsv } from "@/lib/snowballStatsCsvExport";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";
import { fundingRateVisualClass } from "@/src/marketsFormat";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

const FOOTNOTE =
  "ทิศ = ทิศสัญญาณ Snowball · Grade = เกรดสุทธิชั้นเดียว · คลิก Grade ดูโครงสร้าง HH48/VAH และเหตุผล D+/F";

type SnowballDayFilter = "all" | "7" | "30" | "90";
type SnowballGradeFilter = "all" | "A+" | "B" | "C" | "D+" | "F";

const SNOWBALL_DAY_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballDayFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
];

const SNOWBALL_GRADE_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballGradeFilter;
  label: string;
}> = [
  { value: "all", label: "ทุก grade" },
  { value: "A+", label: "A+" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D+", label: "D+" },
  { value: "F", label: "F" },
];

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

function fmtSnowballHorizonCell(
  row: SnowballStatsRow,
  horizonHours: number,
  price: number | null,
  pct: number | null,
): ReactNode {
  if (!snowballStatsHorizonDue(row, horizonHours)) return "-";
  return fmtPctCell(price, pct);
}

function outcomeLabel(o: SnowballStatsRow["outcome"]): string {
  if (o === "pending") return "Pending";
  if (o === "win_quick_tp30") return "Win (Quick TP30%)";
  if (o === "win_trend") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}


export default function SnowballStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<SnowballStatsApiPayload | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [gradeDetailRow, setGradeDetailRow] = useState<SnowballStatsRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctErr, setCorrectErr] = useState<string | null>(null);
  const [correctOk, setCorrectOk] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<SnowballDayFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<SnowballGradeFilter>("all");

  const isAdmin = payload?.isAdmin === true;

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
    setDeleteErr(null);
    setResetErr(null);
  }, [api]);

  const deleteRow = useCallback(
    async (row: SnowballStatsRow) => {
      const label = `${coinLabel(row.symbol)} · ${snowballStatsGradeDisplayLabel(row)} · ${formatBkk(row.alertedAtIso)}`;
      if (
        !window.confirm(
          `ลบแถวสถิติ Snowball นี้?\n\n${label}\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`,
        )
      ) {
        return;
      }
      setDeleteBusy(true);
      setDeleteErr(null);
      try {
        await api(`/snowball-stats/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        setGradeDetailRow(null);
        await loadStats();
      } catch (e) {
        setDeleteErr(e instanceof Error ? e.message : String(e));
      } finally {
        setDeleteBusy(false);
      }
    },
    [api, loadStats],
  );

  const resetAllStats = useCallback(async () => {
    if (
      !window.confirm(
        "ล้างสถิติ Snowball ทั้งหมด?\n\nแถวในตารางจะหายจนมีสัญญาณใหม่ — การดำเนินการนี้ไม่สามารถย้อนกลับได้",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetErr(null);
    try {
      await api("/snowball-stats", { method: "POST" });
      setGradeDetailRow(null);
      await loadStats();
    } catch (e) {
      setResetErr(e instanceof Error ? e.message : String(e));
    } finally {
      setResetBusy(false);
    }
  }, [api, loadStats]);

  const correctOutcomeFromPct24h = useCallback(async () => {
    if (
      !window.confirm(
        "ปรับ result ทุกแถวให้ตรงกับ pct24h?\n\nระบบจะ recompute outcome/RR จากค่า pct24h ที่บันทึกอยู่ — ทับของเดิม โดยไม่สนใจ pending guard",
      )
    ) {
      return;
    }
    setCorrectBusy(true);
    setCorrectErr(null);
    setCorrectOk(null);
    try {
      const r = (await api("/snowball-stats/correct", { method: "POST", body: "{}" })) as {
        ok?: boolean;
        scanned?: number;
        changedOutcome?: number;
        changedRr?: number;
      } | null;
      const scanned = typeof r?.scanned === "number" ? r.scanned : 0;
      const changedOutcome = typeof r?.changedOutcome === "number" ? r.changedOutcome : 0;
      const changedRr = typeof r?.changedRr === "number" ? r.changedRr : 0;
      setCorrectOk(
        `ปรับเสร็จ — สแกน ${scanned} แถว · เปลี่ยน outcome ${changedOutcome} · เปลี่ยน RR ${changedRr}`,
      );
      await loadStats();
    } catch (e) {
      setCorrectErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCorrectBusy(false);
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

  const allRows = payload?.rows ?? [];

  const rows = useMemo(() => {
    let result = allRows;

    if (dayFilter !== "all") {
      const days = Number(dayFilter);
      const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
      result = result.filter((r) => {
        const ms =
          r.alertedAtMs != null && Number.isFinite(r.alertedAtMs)
            ? r.alertedAtMs
            : Date.parse(r.alertedAtIso);
        return Number.isFinite(ms) && ms >= cutoffMs;
      });
    }

    if (gradeFilter !== "all") {
      result = result.filter((r) => snowballStatsGradeDisplayLabel(r) === gradeFilter);
    }

    return result;
  }, [allRows, dayFilter, gradeFilter]);

  const horizonWinrateText = useMemo(
    () =>
      snowballHorizonWinrateSummary(rows, [
        { label: "12h", pctKey: "pct12h" },
        { label: "24h", pctKey: "pct24h" },
        { label: "48h", pctKey: "pct48h" },
      ]),
    [rows],
  );

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    await downloadCsv(statsCsvFilename("snowball-stats"), snowballStatsToCsv(rows), {
      telegramExportPath: "/api/tma/snowball-stats.csv",
      preferClientCsvInTma: true,
    });
  }, [rows]);

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

  return (
    <div className="sparkStatsPage sparkStatsPage--wide">
      <h1 className="sparkStatsMatrixSectionTitle">
        สถิติ Snowball
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          Triple-check log · Binance 15m
        </span>
      </h1>

      <MiniAppStatsNav showHome style={{ marginTop: "0.75rem" }} />

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <div
          className="sparkStatsActionRow"
          style={{
            marginBottom: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: "0.4rem",
          }}
        >
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            ย้อนหลัง
            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.currentTarget.value as SnowballDayFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
            >
              {SNOWBALL_DAY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Grade
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.currentTarget.value as SnowballGradeFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
            >
              {SNOWBALL_GRADE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <span className="sub">
            แสดง {rows.length}/{allRows.length}
          </span>
        </div>
        <p
          className="sub"
          title="Winrate ราย horizon — นับเฉพาะแถวที่มี follow-up ครบ horizon นั้น · เกณฑ์ Win ≥ +3% · Loss ≤ -3% · ทิศของสัญญาณถูกปรับให้บวก = ฝั่งกำไรแล้ว"
          style={{ marginBottom: "0.5rem" }}
        >
          WR · {horizonWinrateText}
        </p>
        <div className="sparkMatrixScroll">
          <table className="sparkMatrixTable sparkMatrixTable--compact">
            <thead>
              <tr>
                <th scope="col" className="snowStatsStickyCoin">
                  เหรียญ
                </th>
                <th scope="col">ทิศ</th>
                <th
                  scope="col"
                  className="snowStatsStickyGrade"
                  title="เกรดสุทธิ (A+/B/C/D+/F) — คลิกดูโครงสร้าง HH48/VAH และเหตุผล"
                >
                  Grade
                </th>
                <th scope="col">วัน</th>
                <th scope="col">เวลา (BKK)</th>
                <th scope="col">Entry</th>
                <th scope="col">Range</th>
                <th scope="col">Wick</th>
                <th scope="col">R% ก่อน</th>
                <th scope="col">R% สัญญาณ</th>
                <th scope="col">R% 2แท่ง</th>
                <th scope="col" title="BTC PSAR — แท่ง 4h และ 1h ปิดล่าสุด (Binance)">
                  BTC SAR
                </th>
                <th scope="col">Vol 24h</th>
                <th
                  scope="col"
                  title="Market cap USD (CoinGecko) ณ เวลาแจ้ง"
                >
                  Mcap
                </th>
                <th
                  scope="col"
                  title="Funding rate สัญญา MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม ×100 = %)"
                >
                  Funding
                </th>
                <th
                  scope="col"
                  title="Vol cascade — volume 5 แท่ง 1H ล่าสุด ยอมไม่ยกฐานได้ 1 ครั้ง"
                >
                  Vol↗
                </th>
                <th
                  scope="col"
                  title="แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ Snowball"
                >
                  เขียว
                </th>
                <th
                  scope="col"
                  title="4h = Vol แท่งสัญญาณ ÷ SMA(4H) (Signal Vol Spurt) · อื่นๆ = 1H confirm หรือ signal"
                >
                  Vol×SMA
                </th>
                <th
                  scope="col"
                  title="อันดับ vol 1H จาก breakout confirm eval (48 แท่งมาตรฐาน) — บันทึกทุกแจ้ง 4h ที่มีข้อมูล 1H"
                >
                  Vol rank
                </th>
                <th scope="col">4h</th>
                <th scope="col">12h</th>
                <th scope="col">24h</th>
                <th scope="col">48h</th>
                <th scope="col">Max ROI</th>
                <th scope="col">Duration→MFE</th>
                <th
                  scope="col"
                  title="Max DD ก่อนแจ้ง — 15m ย้อนหลัง 32 แท่ง (8 ชม.) · เกณฑ์ momentum Stage 3 (≤ default 7%)"
                >
                  Max DD ก่อน
                </th>
                <th
                  scope="col"
                  title="Max DD หลังแจ้ง — drawdown สูงสุดจาก entry (ติดตามผล)"
                >
                  Max DD หลัง
                </th>
                <th scope="col">SVP Hole</th>
                <th scope="col">RR</th>
                <th scope="col">ผล</th>
                {isAdmin ? <th scope="col" className="snowStatsDelCol" aria-label="ลบ" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 32 : 31} className="sub">
                    {allRows.length === 0
                      ? "ยังไม่มีแถว — รอสัญญาณ Snowball ส่งสำเร็จและ SNOWBALL_STATS_ENABLED"
                      : "ไม่มีแถวที่ตรงกับ filter — ลองเลือก ทั้งหมด / ทุก grade"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="snowStatsStickyCoin">{coinLabel(r.symbol)}</td>
                    <td>{snowballStatsSideLabel(r)}</td>
                    <td className={`snowStatsStickyGrade ${snowballStatsGradeCellClass(r)}`}>
                      <button
                        type="button"
                        className="snowGradeCellBtn"
                        title="ดูโครงสร้างและเหตุผลเกรด"
                        onClick={() => setGradeDetailRow(r)}
                      >
                        {snowballStatsGradeDisplayLabel(r)}
                      </button>
                    </td>
                    <td>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {snowballStatsDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}
                      </span>
                    </td>
                    <td>
                      <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                    </td>
                    <td>{fmtPrice(r.entryPrice)}</td>
                    <td>{snowballStatsVolScoreLabel(r.rangeScore)}</td>
                    <td>{snowballStatsVolScoreLabel(r.wickScore)}</td>
                    <td>{snowballStatsBarRangePctLabel(r.barRangePctPrev)}</td>
                    <td>{snowballStatsBarRangePctLabel(r.barRangePctSignal)}</td>
                    <td>{snowballStatsBarRangePctLabel(r.barRangePct2Sum)}</td>
                    <td>{snowballStatsBtcPsarCombinedLabel(r.btcPsar4hTrend, r.btcPsar1hTrend)}</td>
                    <td>{snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt)}</td>
                    <td>{snowballStatsMarketCapUsdLabel(r.marketCapUsd)}</td>
                    <td
                      className={
                        r.fundingRate != null && Number.isFinite(r.fundingRate)
                          ? fundingRateVisualClass(r.fundingRate)
                          : undefined
                      }
                    >
                      {snowballStatsFundingRateLabel(r.fundingRate)}
                    </td>
                    <td>{snowballStatsVolumeCascadeLabel(r.volumeCascadeYn)}</td>
                    <td>{snowballStatsGreenDaysLabel(r.greenDaysBeforeSignal)}</td>
                    <td>{snowballStatsConfirmVolVsSmaLabel(snowballStatsVolVsSmaDisplay(r))}</td>
                    <td>{snowballStatsConfirmVolRankLabel(r.confirmVolRank, r.confirmVolRankLb)}</td>
                    <td>{fmtSnowballHorizonCell(r, 4, r.price4h, r.pct4h)}</td>
                    <td>{fmtSnowballHorizonCell(r, 12, r.price12h, r.pct12h)}</td>
                    <td>{fmtSnowballHorizonCell(r, 24, r.price24h, r.pct24h)}</td>
                    <td>{fmtSnowballHorizonCell(r, 48, r.price48h, r.pct48h)}</td>
                    <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                    <td>
                      {r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
                        ? `${r.durationToMfeHours.toFixed(2)}h`
                        : "—"}
                    </td>
                    <td>
                      {r.signalMaxDdPct != null && Number.isFinite(r.signalMaxDdPct)
                        ? `${r.signalMaxDdPct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                    <td>{r.svpHoleYn}</td>
                    <td>{r.resultRr ?? "—"}</td>
                    <td>{outcomeLabel(r.outcome)}</td>
                    {isAdmin ? (
                      <td className="snowStatsDelCol">
                        <button
                          type="button"
                          className="snowStatsRowDelBtn"
                          title="ลบแถวนี้"
                          disabled={deleteBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteRow(r);
                          }}
                        >
                          ลบ
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
          {FOOTNOTE}
        </p>
        {gradeDetailRow ? (
          <div
            className="snowGradeDetailBackdrop"
            role="presentation"
            onClick={() => setGradeDetailRow(null)}
          >
            <div
              className="snowGradeDetailCard"
              role="dialog"
              aria-labelledby="snowGradeDetailTitle"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="snowGradeDetailCard__head">
                <h2 id="snowGradeDetailTitle" className="snowGradeDetailCard__title">
                  {gradeDetailRow.symbol} · {snowballStatsSideLabel(gradeDetailRow)}
                </h2>
                <button
                  type="button"
                  className="snowGradeDetailCard__close"
                  aria-label="ปิด"
                  onClick={() => setGradeDetailRow(null)}
                >
                  ×
                </button>
              </div>
              <p className={`snowGradeDetailCard__grade ${snowballStatsGradeCellClass(gradeDetailRow)}`}>
                {snowballStatsGradeDisplayLabel(gradeDetailRow)}
              </p>
              {(() => {
                const staged = snowballStatsStagedPopupText(gradeDetailRow);
                if (staged) {
                  return <pre className="snowGradeStagedPre">{staged}</pre>;
                }
                return (
                  <>
                    <ol className="snowGradeChecklist">
                      {snowballStatsGradeChecklist(gradeDetailRow).map((item) => (
                        <li
                          key={item.id}
                          className={`snowGradeChecklist__item snowGradeChecklist__item--${item.status}`}
                        >
                          <span className="snowGradeChecklist__mark" aria-hidden>
                            {snowballGradeChecklistMark(item.status)}
                          </span>
                          <div className="snowGradeChecklist__body">
                            <span className="snowGradeChecklist__title">{item.title}</span>
                            <span className="snowGradeChecklist__detail">{item.detail}</span>
                            {item.failCriteria && item.failCriteria.length > 0 ? (
                              <ul className="snowGradeChecklist__fails">
                                {item.failCriteria.map((c, j) => (
                                  <li key={`${item.id}-fail-${j}`}>{c}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                    {snowballStatsGradeChecklistFooter(gradeDetailRow).length > 0 ? (
                      <ul className="snowGradeDetailCard__list snowGradeDetailCard__list--footer">
                        {snowballStatsGradeChecklistFooter(gradeDetailRow).map((line, i) => (
                          <li key={`f-${i}-${line}`}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                );
              })()}
              {isAdmin ? (
                <div className="snowGradeDetailCard__actions">
                  <button
                    type="button"
                    className="sparkStatsRefreshBtn danger"
                    disabled={deleteBusy}
                    onClick={() => void deleteRow(gradeDetailRow)}
                  >
                    {deleteBusy ? "กำลังลบ…" : "ลบแถวนี้"}
                  </button>
                </div>
              ) : null}
              {deleteErr ? (
                <p className="sub" style={{ color: "var(--danger)", marginTop: "0.5rem" }}>
                  {deleteErr}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="sparkStatsRefreshBtn" onClick={() => void loadStats()}>
            รีเฟรช
          </button>
          <button
            type="button"
            className="sparkStatsRefreshBtn"
            disabled={rows.length === 0}
            onClick={exportCsv}
          >
            Export CSV
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn"
              disabled={correctBusy || allRows.length === 0}
              onClick={() => void correctOutcomeFromPct24h()}
              title="Recompute outcome/RR ทุกแถวจาก pct24h ที่บันทึกอยู่ — ข้าม pending guard (ทำงานบน dataset ทั้งหมด ไม่สนใจ filter)"
            >
              {correctBusy ? "กำลังปรับ…" : "ปรับ result และ backfill"}
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn danger"
              disabled={resetBusy || allRows.length === 0}
              onClick={() => void resetAllStats()}
            >
              {resetBusy ? "กำลังล้าง…" : "ล้างสถิติทั้งหมด"}
            </button>
          ) : null}
        </p>
        {correctErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {correctErr}
          </p>
        ) : null}
        {correctOk && !correctErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "#2a9d6a" }} role="status">
            {correctOk}
          </p>
        ) : null}
        {resetErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {resetErr}
          </p>
        ) : null}
      </section>
    </div>
  );
}
