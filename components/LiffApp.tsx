"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import liff from "@line/liff";

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

/** 401 + เคยส่ง Bearer แล้ว → สันนิษฐานว่าโทเคนใน SDK หมดอายุ ให้ล้าง session แล้วล็อกอินใหม่ */
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

type PriceAlert = {
  id: string;
  coinId: string;
  direction: "above" | "below";
  targetUsd: number;
};

type ContractWatch = {
  id: string;
  coinId: string;
  symbolLabel: string;
  createdAt: string;
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

export default function LiffApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [welcome, setWelcome] = useState("MEXC Futures — จัดการแจ้งเตือน");
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [pctAlerts, setPctAlerts] = useState<PctStepAlert[]>([]);
  const [contractWatches, setContractWatches] = useState<ContractWatch[]>([]);

  const [qSymbol, setQSymbol] = useState("");
  const [priceHtml, setPriceHtml] = useState<ReactNode>(null);
  const [priceErr, setPriceErr] = useState("");

  const [aSymbol, setASymbol] = useState("");
  const [aDir, setADir] = useState<"above" | "below">("above");
  const [aTarget, setATarget] = useState("");
  const [addErr, setAddErr] = useState("");
  const [wSymbol, setWSymbol] = useState("");
  const [wErr, setWErr] = useState("");

  const [pctSymbol, setPctSymbol] = useState("");
  const [pctStep, setPctStep] = useState("");
  const [pctMode, setPctMode] = useState<"daily_07_bkk" | "trailing">("daily_07_bkk");
  const [pctErr, setPctErr] = useState("");

  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      // ดึงจาก SDK ทุกครั้งก่อนยิง request — ห้ามเก็บใน state/localStorage/global นาน
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
    },
    []
  );

  const loadMeta = useCallback(async () => {
    const url = `${apiBase}/api/liff/meta`;
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

  const refreshContractWatches = useCallback(async () => {
    const data = (await api("/contract-watches")) as { watches?: ContractWatch[] };
    setContractWatches(Array.isArray(data.watches) ? data.watches : []);
  }, [api]);

  const refreshPctAlerts = useCallback(async () => {
    const data = (await api("/pct-alerts")) as { pctAlerts?: PctStepAlert[] };
    setPctAlerts(Array.isArray(data.pctAlerts) ? data.pctAlerts : []);
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
              <p className="sub">
                ตรวจ <code>NEXT_PUBLIC_API_BASE_URL</code> (บน Vercel เว้นว่างเพื่อ same-origin)
              </p>
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
        await liff
          .init({ liffId: cfg.liffId, withLoginOnExternalBrowser: true })
          .then(async () => {
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
                      ใน LINE Developers → แท็บ LIFF ของแอปนี้ ให้เปิด scope <code>openid</code> (และ{" "}
                      <code>profile</code>) แล้วลอง <strong>ปิดแอป LINE แล้วเปิด LIFF ใหม่</strong> หรือกดล็อกเอาต์แล้ว
                      ล็อกอินใหม่
                    </p>
                  </>
                );
                setPhase("setup");
              }
              return;
            }

            try {
              const p = await liff.getProfile();
              if (!cancelled) {
                setWelcome(`สวัสดี ${p.displayName || ""} — MEXC Futures USDT`);
              }
            } catch {
              /* ignore */
            }

            try {
              await loadMeta();
              await refreshAlerts();
              await refreshPctAlerts();
              await refreshContractWatches();
              if (!cancelled) {
                setPhase("ready");
              }
            } catch (e) {
              if (!cancelled) {
                setSetupBody(
                  <>
                    <p>ล็อกอินแล้วแต่เรียก API ไม่ได้</p>
                    <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
                    {apiDebugSection(e)}
                    <p className="sub" style={{ marginTop: "0.75rem" }}>
                      ตรวจสอบ <code>LINE_CHANNEL_ID</code> บน Vercel = Channel ID ของแท็บ <strong>LINE Login</strong>{" "}
                      (เดียวกับ LIFF) — ไม่ใช่ Channel ID ของ Messaging API
                    </p>
                    <p className="sub">
                      LIFF ต้องเปิด scope <code>openid</code> — ถ้าได้ 401 ระบบจะลอง{" "}
                      <code>logout</code> + <code>login</code> ให้อัตโนมัติ
                    </p>
                    <p className="sub">
                      เว้น <code>NEXT_PUBLIC_API_BASE_URL</code> ว่างบน Vercel เพื่อเรียก <code>/api/liff</code> แบบ
                      same-origin
                    </p>
                  </>
                );
                setPhase("setup");
              }
            }
          });
      } catch (e) {
        if (!cancelled) {
          setSetupBody(<p>LIFF init ล้มเหลว: {e instanceof Error ? e.message : String(e)}</p>);
          setPhase("setup");
        }
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMeta, refreshAlerts, refreshPctAlerts, refreshContractWatches]);

  const onPrice = async () => {
    setPriceErr("");
    setPriceHtml(null);
    if (!qSymbol.trim()) {
      setPriceErr("ใส่สัญญาหรือย่อ");
      return;
    }
    try {
      const d = (await api(`/price?symbol=${encodeURIComponent(qSymbol.trim())}`)) as {
        contract: string;
        priceUsdt: number;
        signal?: string;
      };
      setPriceHtml(
        <>
          <div className="priceBox">{d.contract}</div>
          <div style={{ marginTop: "0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
            {Number(d.priceUsdt).toLocaleString("en-US", { maximumFractionDigits: 8 })} USDT
          </div>
          <div style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>{d.signal ?? ""}</div>
        </>
      );
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setPriceErr(
          `${e.message}\n\nHTTP ${e.status} ${e.url}\n\n${truncateApiBody(e.bodyText, 4000)}`
        );
      } else {
        setPriceErr(e instanceof Error ? e.message : "ดึงราคาไม่สำเร็จ");
      }
    }
  };

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
    const step = Number(pctStep);
    if (!symbol || !Number.isFinite(step) || step <= 0) {
      setPctErr("กรอกสัญญาและขั้น % ให้ครบ");
      return;
    }
    try {
      await api("/pct-alerts", {
        method: "POST",
        body: JSON.stringify({ symbol, stepPct: step, mode: pctMode }),
      });
      setPctStep("");
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
    if (!confirm("ลบเตือน % นี้?")) return;
    try {
      await api(`/pct-alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshPctAlerts();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  const onAddWatch = async () => {
    setWErr("");
    if (!wSymbol.trim()) {
      setWErr("ใส่สัญญาหรือย่อ");
      return;
    }
    try {
      await api("/contract-watches", {
        method: "POST",
        body: JSON.stringify({ symbol: wSymbol.trim() }),
      });
      setWSymbol("");
      await refreshContractWatches();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setWErr(`${e.message}\n\nHTTP ${e.status} ${e.url}`);
      } else {
        setWErr(e instanceof Error ? e.message : "เพิ่มไม่สำเร็จ");
      }
    }
  };

  const onDeleteWatch = async (id: string) => {
    if (!confirm("เลิกติดตามสัญญานี้?")) return;
    try {
      await api(`/contract-watches/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshContractWatches();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  };

  if (phase === "loading") {
    return (
      <div className="card">
        <p>กำลังโหลด…</p>
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
      <p className="sub liffQuickNav">
        <Link href="/markets">Markets Top 50</Link>
      </p>

      <div className="card">
        <h2>เช็คราคาเร็ว</h2>
        <div className="row cols2">
          <div>
            <label htmlFor="q-symbol">สัญญา / ย่อ (btc, BTC_USDT)</label>
            <input
              id="q-symbol"
              value={qSymbol}
              onChange={(e) => setQSymbol(e.target.value)}
              placeholder="btc"
              autoComplete="off"
            />
          </div>
          <div className="priceActions">
            <button type="button" className="primary" onClick={onPrice}>
              ดูราคา
            </button>
          </div>
        </div>
        {priceHtml ? <div className="sub" style={{ marginTop: "0.5rem" }}>{priceHtml}</div> : null}
        {priceErr ? (
          <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {priceErr}
          </div>
        ) : null}
      </div>

      <div className="card">
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
            <datalist id="syms">
              {shortcuts.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
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
            <label htmlFor="a-target">เป้า (USDT)</label>
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
      </div>

      <div className="card">
        <h2>รายการแจ้งเตือน</h2>
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

      <div className="card">
        <h2>เตือน % (ทุก x%)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          รายวัน: anchor ที่ 07:00 น. (ไทย) · trailing: เลื่อน anchor หลังแจ้ง — เช็คประมาณทุก 15 นาที
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
            <label htmlFor="pct-step">ขั้น % (เช่น 1 = 1%)</label>
            <input
              id="pct-step"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="2"
              value={pctStep}
              onChange={(e) => setPctStep(e.target.value)}
            />
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
          เพิ่มเตือน %
        </button>
        {pctErr ? (
          <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {pctErr}
          </div>
        ) : null}
        <p className="sub" style={{ marginTop: "1rem", marginBottom: "0.35rem", fontWeight: 600 }}>
          รายการเตือน %
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

      <div className="card">
        <h2>ติดตามเงื่อนไขสัญญา</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          แจ้งทาง LINE เมื่อรอบชำระ funding เปลี่ยน หรือ funding ขยับ ≥ 0.1% pt หรือ max order size เปลี่ยน (ไม่แจ้งเมื่อมีแค่เวลาตัดถัดไปเลื่อน)
          (เช็คทุกต้นชั่วโมง)
        </p>
        <div className="row cols2">
          <div>
            <label htmlFor="w-symbol">สัญญา / ย่อ</label>
            <input
              id="w-symbol"
              list="syms"
              value={wSymbol}
              onChange={(e) => setWSymbol(e.target.value)}
              placeholder="btc / STO_USDT"
              autoComplete="off"
            />
          </div>
          <div className="priceActions">
            <button type="button" className="primary" onClick={onAddWatch}>
              เพิ่มการติดตาม
            </button>
          </div>
        </div>
        {wErr ? (
          <div className="err" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {wErr}
          </div>
        ) : null}
        <p className="sub" style={{ marginTop: "1rem", marginBottom: "0.35rem", fontWeight: 600 }}>
          กำลังติดตาม
        </p>
        {contractWatches.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>
            ยังไม่มีรายการ
          </p>
        ) : (
          contractWatches.map((w) => (
            <div key={w.id} className="alertItem">
              <div>
                <strong>{w.coinId}</strong>
                <br />
                <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>เงื่อนไขสัญญา</span>
              </div>
              <button type="button" className="danger" onClick={() => onDeleteWatch(w.id)}>
                ลบ
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
