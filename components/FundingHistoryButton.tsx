"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatFunding } from "@/src/marketsFormat";

type Point = { t: string; r: number };

function formatUtcShort(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}

export default function FundingHistoryButton({ symbol }: { symbol: string }) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets/funding-history?symbol=${encodeURIComponent(symbol)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { error?: string; points?: Point[] };
      if (!res.ok) {
        setError(data.error ?? "โหลดไม่สำเร็จ");
        setPoints([]);
        return;
      }
      setPoints(Array.isArray(data.points) ? data.points : []);
    } catch {
      setError("เครือข่ายผิดพลาด");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const onOpen = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="marketsFundingHistBtn"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title="ประวัติ funding ~24 ชม. (sample รายชั่วโมง)"
        onClick={onOpen}
      >
        24h
      </button>
      {open ? (
        <div className="marketsFundingHistBackdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            className="marketsFundingHistDialog card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="marketsFundingHistHead">
              <h2 id={`${dialogId}-title`} className="marketsFundingHistTitle">
                Funding — {symbol}
              </h2>
              <button type="button" className="marketsFundingHistClose" onClick={() => setOpen(false)} aria-label="ปิด">
                ×
              </button>
            </div>
            <p className="sub marketsFundingHistHint">
              ค่าจาก ticker ชั่วโมงละครั้ง (Top 50 ตาม |funding|) สูงสุด 24 จุด — ต้องรอ cron เก็บข้อมูล
            </p>
            {loading ? (
              <p className="sub">กำลังโหลด…</p>
            ) : error ? (
              <p className="err">{error}</p>
            ) : points.length === 0 ? (
              <p className="sub">ยังไม่มีประวัติสำหรับสัญญานี้</p>
            ) : (
              <div className="marketsFundingHistTableWrap">
                <table className="marketsFundingHistTable">
                  <thead>
                    <tr>
                      <th>เวลา (UTC)</th>
                      <th className="num">Funding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.t}>
                        <td>
                          <code className="marketsFundingHistTime">{formatUtcShort(p.t)} UTC</code>
                        </td>
                        <td className="num">{formatFunding(p.r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
