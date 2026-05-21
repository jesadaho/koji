/** CSV build + download สำหรับตารางสถิติ Mini App (UTF-8 BOM สำหรับ Excel / Google Sheets) */

import { getTelegramInitData } from "@/lib/kojiTelegramWebApp";

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

export type DownloadCsvOptions = {
  /** เช่น `/api/tma/snowball-stats.csv` — fallback ดึงจาก API ด้วย Authorization (ไม่ใช้ ?tma=) */
  telegramExportPath?: string;
};

function apiOrigin(): string {
  if (typeof window === "undefined") return "";
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  return base || window.location.origin;
}

function isTelegramMiniApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
}

/** iOS/Android เท่านั้น — macOS / Telegram Desktop / web ถือเป็น desktop (ใช้ดาวน์โหลดไฟล์) */
function isMobilePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.Telegram?.WebApp?.platform?.toLowerCase() ?? "";
  if (p === "ios" || p === "android") return true;
  if (p === "macos" || p === "tdesktop" || p === "web" || p === "weba" || p === "unknown") {
    return false;
  }
  if (typeof navigator !== "undefined" && /iphone|ipad|ipod|android/i.test(navigator.userAgent ?? "")) {
    return true;
  }
  return false;
}

function parseApiErrorBody(text: string, fallback: string): string {
  const t = text.trim();
  if (!t) return fallback;
  try {
    const j = JSON.parse(t) as { error?: string };
    if (typeof j.error === "string" && j.error) return j.error;
  } catch {
    /* not json */
  }
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/** ดึง CSV จาก API — ใช้ Authorization: tma เหมือนโหลดตาราง (ไม่ส่ง initData ใน query ?tma=) */
async function fetchCsvAuthenticated(
  exportPath: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const initData = getTelegramInitData();
  if (!initData) {
    return { ok: false, error: "ไม่มี initData — เปิดใหม่จากปุ่ม Mini App ในแชท" };
  }
  const url = `${apiOrigin()}${exportPath}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `tma ${initData}` },
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "เชื่อมต่อ API ไม่ได้",
    };
  }
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: parseApiErrorBody(text, res.statusText || `HTTP ${res.status}`) };
  }
  if (text.trimStart().startsWith("{")) {
    return { ok: false, error: parseApiErrorBody(text, "ตอบกลับไม่ใช่ CSV") };
  }
  return { ok: true, csv: text };
}

async function tryShareCsvFile(filename: string, blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    const file = new File([blob], filename, { type: "text/csv;charset=utf-8" });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
    return false;
  }
}

function tryAnchorDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** macOS / Chrome — เลือกที่บันทึก (ได้ไฟล์ .csv ใน Downloads โดยตรง) */
async function trySaveFilePicker(filename: string, blob: Blob): Promise<boolean> {
  const picker = window.showSaveFilePicker;
  if (typeof picker !== "function") return false;
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  try {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
    return false;
  }
}

async function tryClipboardCsv(csv: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(csv);
    return true;
  } catch {
    return false;
  }
}

type DeliverCsvResult = "save" | "download" | "share" | "clipboard" | false;

async function deliverCsvBlob(filename: string, csv: string): Promise<DeliverCsvResult> {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;

  if (!isMobilePlatform()) {
    if (await trySaveFilePicker(name, blob)) return "save";
    tryAnchorDownload(name, blob);
    return "download";
  }

  if (await tryShareCsvFile(name, blob)) return "share";

  if (await tryClipboardCsv(csv)) {
    window.alert("คัดลอก CSV ไปคลิปบอร์ดแล้ว — วางใน Numbers / Excel แล้วบันทึกเป็นไฟล์");
    return "clipboard";
  }

  return false;
}

/**
 * ดาวน์โหลด CSV
 * · Desktop / Telegram macOS: Save dialog หรือ a[download] ลง Downloads
 * · มือถือ: Share sheet / คลิปบอร์ด
 * · ใช้เนื้อหาในหน้าก่อน — ไม่ยิง ?tma= ใน URL
 */
export async function downloadCsv(
  filename: string,
  csv: string,
  opts?: DownloadCsvOptions,
): Promise<void> {
  const exportPath = opts?.telegramExportPath;
  let content = csv;

  if (!content.trim() && exportPath) {
    const fetched = await fetchCsvAuthenticated(exportPath);
    if (!fetched.ok) {
      window.alert(fetched.error);
      return;
    }
    content = fetched.csv;
  }

  if (content.trim() && (await deliverCsvBlob(filename, content))) {
    return;
  }

  if (exportPath) {
    const fetched = await fetchCsvAuthenticated(exportPath);
    if (!fetched.ok) {
      window.alert(fetched.error);
      return;
    }
    if (await deliverCsvBlob(filename, fetched.csv)) {
      return;
    }
  }

  window.alert(
    "ดาวน์โหลดไม่สำเร็จ — ลอง Share / คัดลอก หรือเปิด Mini App ใหม่จากแชท Telegram",
  );
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
