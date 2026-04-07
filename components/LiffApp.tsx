"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import liff from "@line/liff";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

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

type Phase = "loading" | "setup" | "ready";

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || res.statusText };
  }
}

export default function LiffApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [welcome, setWelcome] = useState("MEXC Futures — จัดการแจ้งเตือน");
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  const [qSymbol, setQSymbol] = useState("");
  const [priceHtml, setPriceHtml] = useState<ReactNode>(null);
  const [priceErr, setPriceErr] = useState("");

  const [aSymbol, setASymbol] = useState("");
  const [aDir, setADir] = useState<"above" | "below">("above");
  const [aTarget, setATarget] = useState("");
  const [addErr, setAddErr] = useState("");

  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const idToken = liff.getIDToken();
      const headers: HeadersInit = {
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...((opts.headers as Record<string, string>) ?? {}),
      };
      const res = await fetch(`${apiBase}/api/liff${path}`, { ...opts, headers });
      const data = (await parseJson(res)) as { error?: string } | null;
      if (!res.ok) {
        const err = new Error(data && typeof data === "object" && "error" in data ? String(data.error) : res.statusText);
        throw err;
      }
      return data;
    },
    []
  );

  const loadMeta = useCallback(async () => {
    const res = await fetch(`${apiBase}/api/liff/meta`);
    const raw = await parseJson(res);
    if (!res.ok) {
      const msg =
        raw && typeof raw === "object" && raw !== null && "error" in raw
          ? String((raw as { error: unknown }).error)
          : res.statusText;
      throw new Error(msg);
    }
    const data = raw as { shortcuts?: string[] };
    if (Array.isArray(data.shortcuts)) setShortcuts(data.shortcuts);
  }, []);

  const refreshAlerts = useCallback(async () => {
    const data = (await api("/alerts")) as { alerts?: PriceAlert[] };
    setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let cfg: LiffConfig;
      try {
        const res = await fetch(`${apiBase}/api/liff/config`);
        cfg = (await res.json()) as LiffConfig;
      } catch {
        if (!cancelled) {
          setSetupBody(<p>โหลด config ไม่ได้ — ตรวจสอบเครือข่ายและ NEXT_PUBLIC_API_BASE_URL</p>);
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
      } catch (e) {
        if (!cancelled) {
          setSetupBody(<p>LIFF init ล้มเหลว: {e instanceof Error ? e.message : String(e)}</p>);
          setPhase("setup");
        }
        return;
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();
      if (!idToken) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>ล็อกอินแล้วแต่ไม่มี ID Token</p>
              <p className="sub">
                ใน LINE Developers → แท็บ LIFF ของแอปนี้ ให้เปิด scope <code>openid</code> (และ{" "}
                <code>profile</code>) แล้วลอง <strong>ปิดแอป LINE แล้วเปิด LIFF ใหม่</strong> หรือกดล็อกเอาต์แล้วล็อกอินใหม่
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      if (!cancelled) {
        try {
          const p = await liff.getProfile();
          setWelcome(`สวัสดี ${p.displayName || ""} — MEXC Futures USDT`);
        } catch {
          /* ignore */
        }

        try {
          await loadMeta();
          await refreshAlerts();
          setPhase("ready");
        } catch (e) {
          setSetupBody(
            <>
              <p>ล็อกอินแล้วแต่เรียก API ไม่ได้</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
              <p className="sub">
                ตรวจสอบ <code>LINE_CHANNEL_ID</code> บน Vercel = <strong>Channel ID ตัวเลข</strong> ในแท็บ Basic
                settings ของ <strong>Official Account เดียวกับ LIFF</strong> (ไม่ใช่ LIFF ID / Channel secret)
              </p>
              <p className="sub">
                LIFF ต้องเปิด scope <code>openid</code> — ถ้าเพิ่งแก้ ให้รีเฟรชหน้าแล้วล็อกอินใหม่
              </p>
              <p className="sub">
                โปรดักชันบน Vercel: เว้น <code>NEXT_PUBLIC_API_BASE_URL</code> ว่างเพื่อเรียก{" "}
                <code>/api/liff</code> แบบ same-origin
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
  }, [loadMeta, refreshAlerts]);

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
      setPriceErr(e instanceof Error ? e.message : "ดึงราคาไม่สำเร็จ");
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
      setAddErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
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
        {priceErr ? <div className="err">{priceErr}</div> : null}
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
        {addErr ? <div className="err">{addErr}</div> : null}
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
    </>
  );
}
