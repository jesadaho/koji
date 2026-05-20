/** CSV build + download สำหรับตารางสถิติ Mini App (UTF-8 BOM สำหรับ Excel / Google Sheets) */

export function escapeCsvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function statsCsvFilename(prefix: string): string {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  return `${prefix}-${d}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function statsFmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function statsFmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

export function statsFmtPctCell(price: number | null | undefined, pct: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "";
  return `${statsFmtPrice(price)} (${statsFmtPct(pct)})`;
}

export function statsFmtBkk(iso: string): string {
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

export function statsCoinLabel(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u;
}
