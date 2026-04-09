"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveContractSymbol } from "@/src/coinMap";
import { buildCoinPickerRows, coinRowFromContract, QUICK_PRESET_CONTRACTS } from "./indicatorCoinDisplay";

function chipsToContractSet(chips: string[]): Set<string> {
  const s = new Set<string>();
  for (const raw of chips) {
    const r = resolveContractSymbol(raw.trim());
    if (r) s.add(r.contractSymbol.toUpperCase());
    else if (raw.trim()) s.add(raw.trim().toUpperCase());
  }
  return s;
}

type VolLite = { coinId: string; createdAt: string };
type TechLite = { symbol: string; createdAt: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (contracts: string[]) => void;
  topSymbols: string[];
  volAlerts: VolLite[];
  techRows: TechLite[];
  initialChips: string[];
};

export default function IndicatorCoinPickerModal({
  open,
  onClose,
  onConfirm,
  topSymbols,
  volAlerts,
  techRows,
  initialChips,
}: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const allRows = useMemo(
    () =>
      buildCoinPickerRows({
        topSymbols,
        volAlerts,
        techRows,
      }),
    [topSymbols, volAlerts, techRows]
  );

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(chipsToContractSet(initialChips));
  }, [open, initialChips]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) =>
        r.contract.toLowerCase().includes(q) ||
        r.short.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
    );
  }, [allRows, search]);

  const toggleContract = useCallback((contract: string) => {
    const c = contract.toUpperCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const handleConfirm = () => {
    onConfirm(Array.from(selected).sort());
  };

  const n = selected.size;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ind-coin-picker-title"
      className="indModalBackdrop"
      onClick={onClose}
    >
      <div className="card indModalPanel indCoinPickerPanel" onClick={(e) => e.stopPropagation()}>
        <h3 id="ind-coin-picker-title" style={{ marginTop: 0 }}>
          เลือกเหรียญ
        </h3>
        <p className="indCoinPickerHint">
          เรียงก่อน: เคยตั้งล่าสุด → จาก Vol Top · เลือกได้หลายเหรียญแล้วกดยืนยัน
        </p>

        <label className="srOnly" htmlFor="ind-coin-search">
          ค้นหาเหรียญ
        </label>
        <input
          id="ind-coin-search"
          type="search"
          className="indCoinPickerSearch"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเหรียญ… (เช่น BTC, Sol)"
          autoComplete="off"
          autoFocus
        />

        <p className="indCoinPickerQuickLabel">เลือกด่วน</p>
        <div className="indCoinPickerQuick">
          {QUICK_PRESET_CONTRACTS.map((contract) => {
            const row = coinRowFromContract(contract);
            const on = selected.has(contract);
            return (
              <button
                key={contract}
                type="button"
                className={`indCoinPickerQuickBtn${on ? " indCoinPickerQuickBtn--on" : ""}`}
                onClick={() => toggleContract(contract)}
              >
                {row.short}
              </button>
            );
          })}
        </div>

        <div className="indCoinPickerListWrap">
          <p className="indCoinPickerListCaption">รายชื่อเหรียญ ({filteredRows.length})</p>
          <ul className="indCoinPickerList" role="listbox" aria-label="รายชื่อสัญญา" aria-multiselectable>
            {filteredRows.map((row) => {
              const on = selected.has(row.contract);
              return (
                <li key={row.contract}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`indCoinPickerRow${on ? " indCoinPickerRow--selected" : ""}`}
                    onClick={() => toggleContract(row.contract)}
                  >
                    <span className="indCoinPickerRowCheck" aria-hidden>
                      {on ? "✓" : ""}
                    </span>
                    <span className="indCoinPickerRowIcon" aria-hidden>
                      {row.icon}
                    </span>
                    <span className="indCoinPickerRowSym">{row.short}</span>
                    <span className="indCoinPickerRowName">{row.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filteredRows.length === 0 ? (
            <p className="indCoinPickerEmpty">ไม่พบคู่ที่ตรงกับการค้นหา</p>
          ) : null}
        </div>

        <div className="indCoinPickerFooter">
          <button type="button" className="primary indCoinPickerConfirm" onClick={handleConfirm}>
            ยืนยันการเลือก{n > 0 ? ` (${n} เหรียญ)` : ""}
          </button>
          <button type="button" className="indCoinPickerCancel" onClick={onClose}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
