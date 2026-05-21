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
  /** เช่น `/api/tma/snowball-stats.csv` — ใช้ Telegram.WebApp.downloadFile (ไม่ใช้ blob:) */
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

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent ?? "");
}

/** macOS / Telegram Desktop / เว็บบนคอม — ไม่ใช้กลยุทธ์มือถือ (share / clipboard ก่อน) */
function isDesktopPlatform(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.Telegram?.WebApp?.platform?.toLowerCase() ?? "";
  if (p === "macos" || p === "tdesktop" || p === "web" || p === "weba" || p === "unknown") return true;
  if (p === "ios" || p === "android") return false;
  return !isMobileUserAgent();
}

function buildAuthenticatedCsvUrl(exportPath: string): string | null {
  const initData = getTelegramInitData();
  if (!initData) return null;
  return `${apiOrigin()}${exportPath}?tma=${encodeURIComponent(initData)}`;
}

type TgWebAppDownload = {
  downloadFile?: (
    params: { url: string; file_name: string },
    callback?: (accepted: boolean) => void,
  ) => void;
};

function tryTelegramDownloadFile(filename: string, exportPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const initData = getTelegramInitData();
    const w = window.Telegram?.WebApp as TgWebAppDownload | undefined;
    if (!initData || !w?.downloadFile) {
      resolve(false);
      return;
    }
    const url = `${apiOrigin()}${exportPath}?tma=${encodeURIComponent(initData)}`;
    try {
      w.downloadFile({ url, file_name: filename }, (accepted) => resolve(Boolean(accepted)));
    } catch {
      resolve(false);
    }
  });
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
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** ดาวน์โหลดผ่าน URL จริง (ไม่ใช้ blob:) — เหมาะกับ Telegram Desktop บน Mac */
function tryHttpsCsvDownload(exportPath: string): boolean {
  const url = buildAuthenticatedCsvUrl(exportPath);
  if (!url) return false;
  try {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => iframe.remove(), 120_000);
    return true;
  } catch {
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

/**
 * ดาวน์โหลด CSV
 * · Mac / Desktop: โหลดจาก URL API (ไม่ใช้ blob: ใน Telegram) หรือ a[download] นอก Telegram
 * · มือถือใน Telegram: downloadFile / Share / คลิปบอร์ด
 */
export async function downloadCsv(
  filename: string,
  csv: string,
  opts?: DownloadCsvOptions,
): Promise<void> {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const exportPath = opts?.telegramExportPath;
  const inTma = isTelegramMiniApp();
  const desktop = isDesktopPlatform();

  if (inTma && exportPath) {
    const ok = await tryTelegramDownloadFile(filename, exportPath);
    if (ok) return;
  }

  if (desktop) {
    if (exportPath && tryHttpsCsvDownload(exportPath)) return;
    if (!inTma) {
      tryAnchorDownload(filename, blob);
      return;
    }
    window.alert("ดาวน์โหลดไม่สำเร็จ — ลองปิดแล้วเปิด Mini App ใหม่ หรืออัปเดต Telegram Desktop");
    return;
  }

  if (await tryShareCsvFile(filename, blob)) return;

  if (await tryClipboardCsv(csv)) {
    window.alert("คัดลอก CSV ไปคลิปบอร์ดแล้ว — วางใน Numbers / Excel แล้วบันทึกเป็นไฟล์");
    return;
  }

  window.alert("ดาวน์โหลดไม่สำเร็จ — ลองอัปเดต Telegram หรือเปิด Mini App ในเบราว์เซอร์");
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
