"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  SPARK_STATS_HORIZON_LABELS,
  SPARK_STATS_HORIZON_ORDER,
  type SparkHorizonId,
  type SparkStatsApiPayload,
  type SparkSymbolCount,
  type SparkSymbolMatrixRow,
} from "@/src/sparkStatsShared";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

/** อธิบายท้ายตารางแยกเหรียญ: ตัวหารต่อช่วง ≠ n เมื่อดึงราคาไม่ได้บางจุด */
const SPARK_SYMBOL_MATRIX_FOOTNOTE =
  "แต่ละคอลัมน์คิด win จากเหตุการณ์ที่มีราคาตอนจุดวัดนั้น (wins/total) — total อาจน้อยกว่า n ถ้าบางครั้งดึงราคาไม่สำเร็จ; — = ไม่มีเหตุการณ์ใดมีผลชัดเจนในช่องนั้น แม้แถวจะจบครบแล้วก็ตาม";

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

type HorizonRecord = SparkStatsApiPayload["totalHorizons"];

function HorizonCompactRow({ horizons }: { horizons: HorizonRecord }) {
  return (
    <div className="sparkMatrixScroll">
      <table className="sparkMatrixTable sparkMatrixTable--compact">
        <thead>
          <tr>
            {SPARK_STATS_HORIZON_ORDER.map((hid) => (
              <th key={hid} scope="col">
                {SPARK_STATS_HORIZON_LABELS[hid]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {SPARK_STATS_HORIZON_ORDER.map((hid) => (
              <td key={hid}>
                <MatrixCell cell={horizons[hid]} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SparkStatsMatrixSection({
  sectionId,
  title,
  titleEn,
  intro,
  children,
}: {
  sectionId: string;
  title: string;
  titleEn: string;
  intro: string;
  children: ReactNode;
}) {
  const headingId = `spark-matrix-section-${sectionId}`;
  return (
    <section className="sparkStatsMatrixSection" aria-labelledby={headingId}>
      <h2 id={headingId} className="sparkStatsMatrixSectionTitle">
        {title}
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem", fontSize: "0.88em" }}>
          {titleEn}
        </span>
      </h2>
      <p className="sparkStatsMatrixSectionIntro">{intro}</p>
      {children}
    </section>
  );
}

function MatrixCell({ cell }: { cell: { wins: number; total: number; rate: number | null } }) {
  if (cell.total <= 0) {
    return <span className="sparkMatrixCell">—</span>;
  }
  return (
    <span className="sparkMatrixCell">
      <span className="sparkMatrixPct">{cell.rate != null ? `${cell.rate.toFixed(1)}%` : "—"}</span>
      <span className="sparkMatrixN">
        {" "}
        ({cell.wins}/{cell.total})
      </span>
    </span>
  );
}

function SymbolCountBlock({
  title,
  titleEn,
  hint,
  rows,
}: {
  title: string;
  titleEn: string;
  hint: string;
  rows: SparkSymbolCount[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="sparkSymbolCountSection">
      <h3>
        {title}
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", fontSize: "0.85em", marginTop: "0.1rem" }}>
          {titleEn}
        </span>
      </h3>
      <p className="sub" style={{ marginTop: "0.25rem" }}>
        {hint}
      </p>
      <div className="sparkMatrixScroll">
        <table className="sparkSymbolCountTable">
          <thead>
            <tr>
              <th scope="col">เหรียญ</th>
              <th scope="col">ครั้ง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <th scope="row">{r.label}</th>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SymbolMatrixTable({
  title,
  titleEn,
  hint,
  rows,
  titleTag = "h2",
}: {
  title: string;
  titleEn: string;
  hint: string;
  rows: SparkSymbolMatrixRow[];
  /** ใช้ h3 เมื่ออยู่ภายใต้ SparkStatsMatrixSection */
  titleTag?: "h2" | "h3";
}) {
  if (rows.length === 0) return null;
  const Title = titleTag;
  return (
    <div style={{ marginTop: "1rem" }}>
      <Title style={{ marginBottom: "0.35rem", fontSize: titleTag === "h3" ? "0.95rem" : undefined }}>
        {title}
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          {titleEn}
        </span>
      </Title>
      <p className="sub" style={{ marginTop: 0 }}>
        {hint}
      </p>
      <div className="sparkMatrixScroll">
        <table className="sparkMatrixTable">
          <thead>
            <tr>
              <th scope="col">เหรียญ</th>
              <th scope="col">n</th>
              {SPARK_STATS_HORIZON_ORDER.map((hid) => (
                <th key={hid} scope="col">
                  {SPARK_STATS_HORIZON_LABELS[hid]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <th scope="row">{row.label}</th>
                <td>{row.eventCount}</td>
                {SPARK_STATS_HORIZON_ORDER.map((hid: SparkHorizonId) => (
                  <td key={hid}>
                    <MatrixCell cell={row.horizons[hid]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const WIN_RATE_MATRIX_DEFAULT_HINT =
  "Momentum win rate ตามจุดวัดผลหลังจุดอ้างอิงเวลา (แถว = กลุ่ม · คอลัมน์ = T+10m … T+4h; 10m = สถิติเงียบ · อ้าง last + timestamp / series ไม่ใช่ TF)";

function WinRateMatrixTable({
  title,
  titleEn,
  rows,
  titleTag = "h2",
  hint = WIN_RATE_MATRIX_DEFAULT_HINT,
}: {
  title: string;
  titleEn: string;
  rows: SparkStatsApiPayload["matrixByVol"] | SparkStatsApiPayload["matrixByMcap"];
  titleTag?: "h2" | "h3";
  /** ส่งค่าว่าง "" เพื่อไม่แสดงบรรทัดอธิบาย (ใช้ในบล็อกที่มีหัวข้อหลักแล้ว) */
  hint?: string;
}) {
  const Title = titleTag;
  return (
    <div style={{ marginTop: "1rem" }}>
      <Title style={{ marginBottom: "0.35rem", fontSize: titleTag === "h3" ? "0.95rem" : undefined }}>
        {title}
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          {titleEn}
        </span>
      </Title>
      {hint ? (
        <p className="sub" style={{ marginTop: 0 }}>
          {hint}
        </p>
      ) : null}
      <div className="sparkMatrixScroll">
        <table className="sparkMatrixTable">
          <thead>
            <tr>
              <th scope="col">กลุ่ม</th>
              {SPARK_STATS_HORIZON_ORDER.map((hid) => (
                <th key={hid} scope="col">
                  {SPARK_STATS_HORIZON_LABELS[hid]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.band}>
                <th scope="row">{row.labelTh}</th>
                {SPARK_STATS_HORIZON_ORDER.map((hid: SparkHorizonId) => (
                  <td key={hid}>
                    <MatrixCell cell={row.horizons[hid]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SparkStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<SparkStatsApiPayload | null>(null);
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
    const data = (await api("/spark-stats")) as SparkStatsApiPayload;
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
              <p className="sub">
                ใส่ bot token ใน env ของเซิร์ฟเวอร์ (ใช้ยืนยัน initData ของ Mini App)
              </p>
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
                ใน BotFather ตั้ง Menu Button / Web App URL ชี้มาที่โดเมนนี้ แล้วเปิดจากแอป Telegram
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      try {
        await loadStats();
        if (!cancelled) {
          setPhase("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>เรียกสถิติ Spark ไม่ได้</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
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

  if (!payload) {
    return (
      <div className="card">
        <p>ไม่มีข้อมูล</p>
      </div>
    );
  }

  const thTotal = payload.totalHorizons;

  return (
    <main className="sparkStatsPage">
      <h1>สถิติ Spark</h1>
      <p className="sub">
        Spark follow-up · Win-rate matrix
        <span className="tmaTabEn" style={{ display: "block", marginTop: "0.15rem" }}>
          Momentum vs fade (global)
        </span>
      </p>
      <p className="sub tmaQuickNav">
        <Link href="/">เปิดแอป</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/markets">Markets</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <strong aria-current="page">สถิติ Spark · Matrix</strong>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/markets?sort=funding">Top Funding</Link>
        <span className="siteNavSep" aria-hidden>
          |
        </span>
        <Link href="/settings">Settings</Link>
      </p>

      <div className="card">
        {payload.sparkStatsPersistenceEnabled === false ? (
          <div
            className="sparkStatsPersistWarn"
            role="alert"
            style={{
              marginBottom: "0.85rem",
              padding: "0.65rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--card) 85%, #c45c26)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            <strong>ยังไม่มีที่เก็บถาวรสำหรับสถิติ Spark</strong>
            <span className="tmaTabEn" style={{ display: "block", marginTop: "0.2rem", fontWeight: "normal" }}>
              Vercel needs REDIS_URL or Vercel KV
            </span>
            <p style={{ margin: "0.5rem 0 0" }}>
              แจ้งเตือน Spark ยังส่งได้ แต่ <strong>log / matrix จะไม่สะสม</strong> จนกว่าจะตั้ง{" "}
              <code>REDIS_URL</code> หรือ <code>KV_REST_API_URL</code> แล้ว redeploy
            </p>
          </div>
        ) : null}
        {payload.sparkMatrixEmptyHint === "fire_log_only" ? (
          <div
            className="sparkStatsMatrixHint"
            role="status"
            style={{
              marginBottom: "0.85rem",
              padding: "0.65rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--card) 88%, #2a6ea8)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            <strong>Matrix ยังเป็น — เพราะยังไม่มี follow-up จบครบ</strong>
            <span className="tmaTabEn" style={{ display: "block", marginTop: "0.2rem", fontWeight: "normal" }}>
              Spark log counts fires; win-rate needs resolved T+10m…T+4h rows (~4h after signal).
            </span>
            <p style={{ margin: "0.5rem 0 0" }}>
              ตาราง &quot;เหรียญใน Spark log&quot; นับทุกครั้งที่แจ้งแล้ว — แต่คอลัมน์ 10m–4h มาจากแถว &quot;follow-up จบแล้ว&quot; เท่านั้น (ครบ T+4h แล้วถึงเข้า history) แม้เวลาจะผ่าน 10 นาทีแล้ว matrix จึงยังเป็น — จนกว่าจะจบครบรอบ
            </p>
            <p style={{ margin: "0.45rem 0 0" }}>
              หมายเหตุ: จุด T+10m / T+30m / T+1h … เป็น<strong>สถิติเงียบ</strong> — ไม่ส่ง LINE/Telegram ที่ checkpoint (บันทึกใน state เท่านั้น) ดูคิว pending ด้านล่างถ้ามี
            </p>
          </div>
        ) : null}
        {payload.sparkMatrixEmptyHint === "history_without_momentum" ? (
          <div
            className="sparkStatsMatrixHint"
            role="status"
            style={{
              marginBottom: "0.85rem",
              padding: "0.65rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--card) 88%, #a86e2a)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            <strong>มี follow-up จบแล้ว แต่ทุกช่วง momentum เป็น null</strong>
            <span className="tmaTabEn" style={{ display: "block", marginTop: "0.2rem", fontWeight: "normal" }}>
              Price fetch may have failed at checkpoints, or rows predate momentum fields.
            </span>
            <p style={{ margin: "0.5rem 0 0" }}>
              Matrix จึงแสดง — จนกว่ารอบใหม่จะบันทึกผลชนะ/แพ้ได้ครบ — ลองเช็ค cron ดึงราคาและ log ล่าสุดใน &quot;follow-up จบแล้ว&quot;
            </p>
          </div>
        ) : null}
        <p className="sub" style={{ marginTop: 0 }}>
          อัปเดต: {new Date(payload.generatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · Spark log{" "}
          {payload.fireLogCount} ครั้ง · follow-up จบแล้ว {payload.historyCount} · คิว {payload.pendingCount}
        </p>
        {payload.emptyGlobal ? (
          <p>
            {payload.sparkStatsPersistenceEnabled === false
              ? "ด้านบนคือสาเหตุที่เห็นเลข 0 — หลังตั้ง KV/Redis แล้ว สถิติจะเริ่มนับจากเหตุการณ์ถัดไป"
              : "ยังไม่มี log Spark — หลังแจ้งเตือนสำเร็จจะบันทึกที่นี่ (โฮสต์ต้องมี Redis/KV ให้ state)"}
          </p>
        ) : (
          <>
            <p className="sub">
              แจ้ง Spark (log): ขึ้น {payload.upFire} · ลง {payload.downFire} · สรุปจบแล้ว: Spark ขึ้น {payload.upSpark}{" "}
              · ลง {payload.downSpark}
            </p>
            <SymbolCountBlock
              title="เหรียญใน Spark log"
              titleEn="Symbols (fire log)"
              hint="นับทุกครั้งที่แจ้ง Spark สำเร็จ — รายการอิงตาม log ที่เซิร์ฟเวอร์เก็บ (อาจไม่ครบทุกเหตุการณ์ย้อนหลังถ้า log ถูกตัดตามความยาว)"
              rows={payload.sparkFireLogBySymbol ?? []}
            />
            <SymbolCountBlock
              title="เหรียญที่ follow-up จบแล้ว"
              titleEn="Symbols (resolved follow-ups)"
              hint="นับตามเหตุการณ์ที่จบครบช่วงวัดผล — เหรียญเดียวอาจมีหลายครั้ง"
              rows={payload.followUpHistoryBySymbol ?? []}
            />

            <SparkStatsMatrixSection
              sectionId="overall"
              title="รวมทั้งหมด"
              titleEn="Overall — all directions"
              intro="ทุกเหตุการณ์ follow-up ที่จบแล้ว (รวม Spark ขึ้นและลง) — แถวสรุป · Vol · มาร์ก. · แยกเหรียญ อยู่ในบล็อกนี้ทั้งหมด"
            >
              <HorizonCompactRow horizons={thTotal} />
              <WinRateMatrixTable
                title="Win-rate ตาม Vol 24h"
                titleEn="By volume band"
                rows={payload.matrixByVol}
                titleTag="h3"
                hint=""
              />
              <WinRateMatrixTable
                title="Win-rate ตามมาร์เก็ตแคป (พร็อกซี)"
                titleEn="By mcap proxy"
                rows={payload.matrixByMcap}
                titleTag="h3"
                hint=""
              />
              <SymbolMatrixTable
                title="แยกรายเหรียญ"
                titleEn="Per-symbol matrix"
                hint={`แถวละสัญญา · n = จำนวนเหตุการณ์ในบล็อกนี้ · คอลัมน์ = T+10m … T+4h · ${SPARK_SYMBOL_MATRIX_FOOTNOTE}`}
                rows={payload.matrixBySymbol ?? []}
                titleTag="h3"
              />
            </SparkStatsMatrixSection>

            <SparkStatsMatrixSection
              sectionId="spark-up"
              title="Spark ขึ้น (return > 0)"
              titleEn="Spark up only"
              intro="เฉพาะเหตุการณ์ที่ sparkReturnPct > 0 ตอนอ้างอิง — win rate รวม · แยก Vol/มาร์ก. · แยกเหรียญ ใช้ชุดข้อมูลเดียวกันในบล็อกนี้"
            >
              <HorizonCompactRow horizons={payload.totalHorizonsSparkUp} />
              <WinRateMatrixTable
                title="Win-rate ตาม Vol 24h"
                titleEn="By volume (Spark up)"
                rows={payload.matrixByVolSparkUp}
                titleTag="h3"
                hint=""
              />
              <WinRateMatrixTable
                title="Win-rate ตามมาร์เก็ตแคป (พร็อกซี)"
                titleEn="By mcap (Spark up)"
                rows={payload.matrixByMcapSparkUp}
                titleTag="h3"
                hint=""
              />
              <SymbolMatrixTable
                title="แยกรายเหรียญ"
                titleEn="Per-symbol (Spark up)"
                hint={`เฉพาะเหตุการณ์ Spark ขึ้นในแต่ละสัญญา · n = จำนวนในบล็อกนี้ · ${SPARK_SYMBOL_MATRIX_FOOTNOTE}`}
                rows={payload.matrixBySymbolSparkUp ?? []}
                titleTag="h3"
              />
            </SparkStatsMatrixSection>

            <SparkStatsMatrixSection
              sectionId="spark-down"
              title="Spark ลง (return < 0)"
              titleEn="Spark down only"
              intro="เฉพาะเหตุการณ์ที่ sparkReturnPct < 0 ตอนอ้างอิง — win rate รวม · แยก Vol/มาร์ก. · แยกเหรียญ ใช้ชุดข้อมูลเดียวกันในบล็อกนี้"
            >
              <HorizonCompactRow horizons={payload.totalHorizonsSparkDown} />
              <WinRateMatrixTable
                title="Win-rate ตาม Vol 24h"
                titleEn="By volume (Spark down)"
                rows={payload.matrixByVolSparkDown}
                titleTag="h3"
                hint=""
              />
              <WinRateMatrixTable
                title="Win-rate ตามมาร์เก็ตแคป (พร็อกซี)"
                titleEn="By mcap (Spark down)"
                rows={payload.matrixByMcapSparkDown}
                titleTag="h3"
                hint=""
              />
              <SymbolMatrixTable
                title="แยกรายเหรียญ"
                titleEn="Per-symbol (Spark down)"
                hint={`เฉพาะเหตุการณ์ Spark ลงในแต่ละสัญญา · n = จำนวนในบล็อกนี้ · ${SPARK_SYMBOL_MATRIX_FOOTNOTE}`}
                rows={payload.matrixBySymbolSparkDown ?? []}
                titleTag="h3"
              />
            </SparkStatsMatrixSection>

            <p className="sub" style={{ marginTop: "1rem" }}>
              หมายเหตุ: มาร์ก. ไม่ใช่ CoinGecko — จัดกลุ่มจากฐานสินทรัพย์ (BTC/ETH · tier2 env · อื่นๆ) เหมือนข้อความคำสั่ง
              &quot;สถิติ spark&quot;
            </p>
          </>
        )}

        {loadErr ? <p className="err">{loadErr}</p> : null}
        <p style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="field sparkStatsRefreshBtn"
            onClick={() => {
              void (async () => {
                try {
                  await loadStats();
                } catch (e) {
                  setLoadErr(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
          >
            รีเฟรช
          </button>
        </p>
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/">← กลับหน้าแจ้งเตือน</Link>
      </p>
    </main>
  );
}
