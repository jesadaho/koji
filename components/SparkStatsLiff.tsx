"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import liff from "@line/liff";
import {
  SPARK_STATS_HORIZON_LABELS,
  SPARK_STATS_HORIZON_ORDER,
  type SparkHorizonId,
  type SparkStatsApiPayload,
} from "@/src/sparkStatsShared";

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

function reloginIfUnauthorized(status: number, hadIdToken: boolean): void {
  if (status !== 401 || !hadIdToken) return;
  try {
    liff.logout();
  } catch {
    /* ignore */
  }
  liff.login();
}

type LiffConfig = {
  liffId: string | null;
  channelIdConfigured: boolean;
};

type Phase = "loading" | "setup" | "ready";

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

function WinRateMatrixTable({
  title,
  titleEn,
  rows,
}: {
  title: string;
  titleEn: string;
  rows: SparkStatsApiPayload["matrixByVol"] | SparkStatsApiPayload["matrixByMcap"];
}) {
  return (
    <div style={{ marginTop: "1rem" }}>
      <h2 style={{ marginBottom: "0.35rem" }}>
        {title}
        <span className="liffTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          {titleEn}
        </span>
      </h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Momentum win rate ตามจุดวัดผลหลังจุดอ้างอิงเวลา (แถว = กลุ่ม · คอลัมน์ = T+15m … T+4h; 15m = สถิติเงียบ · อ้าง last + timestamp / series ไม่ใช่ TF)
      </p>
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

export default function SparkStatsLiff() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<SparkStatsApiPayload | null>(null);
  const [loadErr, setLoadErr] = useState("");

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const idToken = liff.getIDToken();
    const headers: HeadersInit = {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    };
    const url = `${apiBase}/api/liff${path}`;
    const res = await fetch(url, { ...opts, headers });
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      reloginIfUnauthorized(res.status, Boolean(idToken));
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
      let cfg: LiffConfig;
      try {
        const configUrl = `${apiBase}/api/liff/config`;
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
        cfg = parsed as LiffConfig;
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

      if (!cfg.liffId) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>ยังไม่ตั้งค่า LIFF</strong>
              </p>
              <p className="sub">
                ใส่ <code>LIFF_ID</code> ใน <code>.env</code> ของเซิร์ฟเวอร์หลัก แล้วรีสตาร์ท
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      if (!cfg.channelIdConfigured) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>ยังไม่ตั้งค่า Channel ID</strong>
              </p>
              <p className="sub">
                ใส่ <code>LINE_CHANNEL_ID</code> ใน backend เพื่อยืนยันตัวตน LIFF
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      try {
        await liff.init({ liffId: cfg.liffId, withLoginOnExternalBrowser: true });
        if (cancelled) return;

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const freshToken = liff.getIDToken();
        if (!freshToken) {
          if (!cancelled) {
            setSetupBody(
              <>
                <p>ล็อกอินแล้วแต่ไม่มี ID Token</p>
                <p className="sub">
                  ใน LINE Developers → แท็บ LIFF ของแอปนี้ ให้เปิด scope <code>openid</code> แล้วลองปิดแอป LINE แล้วเปิด LIFF ใหม่
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
      } catch (e) {
        if (!cancelled) {
          setSetupBody(<p>LIFF init ล้มเหลว: {e instanceof Error ? e.message : String(e)}</p>);
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
        <span className="liffTabEn" style={{ display: "block", marginTop: "0.15rem" }}>
          Momentum vs fade (global)
        </span>
      </p>
      <p className="sub liffQuickNav">
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
        <p className="sub" style={{ marginTop: 0 }}>
          อัปเดต: {new Date(payload.generatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · Spark log{" "}
          {payload.fireLogCount} ครั้ง · follow-up จบแล้ว {payload.historyCount} · คิว {payload.pendingCount}
        </p>
        {payload.emptyGlobal ? (
          <p>ยังไม่มี log Spark — หลังแจ้งเตือนสำเร็จจะบันทึกที่นี่ (ต้องมี Redis/KV บนโฮสต์)</p>
        ) : (
          <>
            <p className="sub">
              แจ้ง Spark (log): ขึ้น {payload.upFire} · ลง {payload.downFire} · สรุปจบแล้ว: Spark ขึ้น {payload.upSpark}{" "}
              · ลง {payload.downSpark}
            </p>
            <h2 style={{ marginTop: "1rem", marginBottom: "0.35rem" }}>
              รวมทั้งหมด
              <span className="liffTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
                Overall
              </span>
            </h2>
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
                        <MatrixCell cell={thTotal[hid]} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <WinRateMatrixTable title="Win-rate ตาม Vol 24h" titleEn="By volume band" rows={payload.matrixByVol} />
            <WinRateMatrixTable
              title="Win-rate ตามมาร์เก็ตแคป (พร็อกซี)"
              titleEn="By mcap proxy"
              rows={payload.matrixByMcap}
            />

            <h2 style={{ marginTop: "1.25rem", marginBottom: "0.35rem" }}>
              Spark ขึ้น (return &gt; 0)
              <span className="liffTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
                Spark up only
              </span>
            </h2>
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
                        <MatrixCell cell={payload.totalHorizonsSparkUp[hid]} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <WinRateMatrixTable title="Vol — Spark ขึ้น" titleEn="By volume (up)" rows={payload.matrixByVolSparkUp} />
            <WinRateMatrixTable title="มาร์ก. — Spark ขึ้น" titleEn="By mcap (up)" rows={payload.matrixByMcapSparkUp} />

            <h2 style={{ marginTop: "1.25rem", marginBottom: "0.35rem" }}>
              Spark ลง (return &lt; 0)
              <span className="liffTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
                Spark down only
              </span>
            </h2>
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
                        <MatrixCell cell={payload.totalHorizonsSparkDown[hid]} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <WinRateMatrixTable title="Vol — Spark ลง" titleEn="By volume (down)" rows={payload.matrixByVolSparkDown} />
            <WinRateMatrixTable title="มาร์ก. — Spark ลง" titleEn="By mcap (down)" rows={payload.matrixByMcapSparkDown} />

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
