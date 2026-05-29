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
  /** เช่น `/api/tma/snowball-stats.csv` — fallback สำหรับ Telegram.WebApp.downloadFile */
  telegramExportPath?: string;
  /** ใน TMA ใช้ CSV จากหน้า (ตรงตาราง) ก่อนดึงจาก API */
  preferClientCsvInTma?: boolean;
};

function apiOrigin(): string {
  if (typeof window === "undefined") return "";
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  return base || window.location.origin;
}

function isTelegramMiniApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
}

/** iOS/Android ใน Telegram */
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

function csvPathFromExportPath(exportPath: string): string | null {
  const trimmed = exportPath.trim();
  const noQuery = trimmed.split("?")[0] ?? trimmed;
  const m = noQuery.match(/\/([^/]+\.csv)$/i);
  return m ? m[1]! : null;
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

async function fetchCsvExportToken(csvPath: string): Promise<string | null> {
  const initData = getTelegramInitData();
  if (!initData) return null;
  try {
    const res = await fetch(`${apiOrigin()}/api/tma/csv-export-token`, {
      method: "POST",
      headers: {
        Authorization: `tma ${initData}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: csvPath }),
    });
    const text = await res.text();
    if (!res.ok) return null;
    const j = JSON.parse(text) as { token?: string };
    return typeof j.token === "string" && j.token ? j.token : null;
  } catch {
    return null;
  }
}

function buildTelegramCsvDownloadUrl(exportPath: string, token: string): string {
  const sep = exportPath.includes("?") ? "&" : "?";
  return `${apiOrigin()}${exportPath}${sep}csv_token=${encodeURIComponent(token)}`;
}

async function telegramCsvDownloadUrl(exportPath: string): Promise<string | null> {
  const csvPath = csvPathFromExportPath(exportPath);
  if (!csvPath) return null;
  const token = await fetchCsvExportToken(csvPath);
  if (!token) return null;
  return buildTelegramCsvDownloadUrl(exportPath, token);
}

/** Telegram.WebApp.downloadFile — HTTPS จริง + token สั้น (ไม่ใช้ blob:) */
async function tryTelegramDownloadFile(filename: string, exportPath: string): Promise<boolean> {
  const w = window.Telegram?.WebApp;
  if (!w?.downloadFile) return false;

  const url = await telegramCsvDownloadUrl(exportPath);
  if (!url) return false;

  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 12_000);
    try {
      w.downloadFile!({ url, file_name: name }, (accepted) => {
        window.clearTimeout(timer);
        finish(Boolean(accepted));
      });
    } catch {
      window.clearTimeout(timer);
      finish(false);
    }
  });
}

/** เปิด URL ดาวน์โหลดในเบราว์เซอร์ภายนอก (มือถือ/เดสก์ท็อปที่ downloadFile ไม่ขึ้น) */
async function tryTelegramOpenLinkDownload(exportPath: string): Promise<boolean> {
  const w = window.Telegram?.WebApp;
  if (!w?.openLink) return false;
  const url = await telegramCsvDownloadUrl(exportPath);
  if (!url) return false;
  try {
    w.openLink(url);
    return true;
  } catch {
    return false;
  }
}

async function tryShareCsvFile(filename: string, blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    const file = new File([blob], name, { type: "text/csv;charset=utf-8" });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return false;
    return false;
  }
}

/** เฉพาะนอก Telegram — ใน WebView จะขึ้น Open Link */
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

type SaveFilePickerHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFilePickerHandle>;
};

async function trySaveFilePicker(filename: string, blob: Blob): Promise<boolean> {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
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
    if (e instanceof DOMException && e.name === "AbortError") return false;
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

async function deliverCsvBlob(
  filename: string,
  csv: string,
  exportPath?: string,
  preferClientCsvInTma?: boolean,
): Promise<boolean> {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const name = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const inTma = isTelegramMiniApp();
  const hasClientCsv = Boolean(csv.trim());

  if (inTma) {
    const tryClientBlobDelivery = async (): Promise<boolean> => {
      if (!hasClientCsv) return false;
      if (!isMobilePlatform() && (await trySaveFilePicker(name, blob))) return true;
      if (await tryShareCsvFile(name, blob)) return true;
      return false;
    };

    const tryServerCsvDelivery = async (): Promise<boolean> => {
      if (!exportPath) return false;
      if (await tryTelegramDownloadFile(name, exportPath)) return true;
      if (await tryTelegramOpenLinkDownload(exportPath)) {
        window.alert("เปิดลิงก์ดาวน์โหลดในเบราว์เซอร์แล้ว — กดบันทึก/แชร์ไฟล์ CSV จากหน้านั้น");
        return true;
      }
      return false;
    };

    // Snowball ฯลฯ — desktop: CSV ตามตัวกรอง (Share/Save) ก่อน · mobile: downloadFile ก่อน (Share ใน WebView มักไม่ขึ้น)
    if (preferClientCsvInTma && hasClientCsv) {
      if (isMobilePlatform()) {
        if (await tryServerCsvDelivery()) return true;
        if (await tryClientBlobDelivery()) return true;
      } else {
        if (await tryClientBlobDelivery()) return true;
        if (await tryServerCsvDelivery()) return true;
      }
    } else {
      if (await tryServerCsvDelivery()) return true;
      if (await tryClientBlobDelivery()) return true;
    }

    if (await tryClipboardCsv(csv)) {
      window.alert("คัดลอก CSV ไปคลิปบอร์ดแล้ว — วางใน Numbers / Excel แล้วบันทึกเป็นไฟล์");
      return true;
    }
    return false;
  }

  if (await trySaveFilePicker(name, blob)) return true;
  tryAnchorDownload(name, blob);
  return true;
}

/**
 * ดาวน์โหลด CSV
 * · ใน Telegram: downloadFile (HTTPS) → Save dialog (macOS) → Share
 * · นอก Telegram: Save dialog / a[download]
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

  const preferClient = opts?.preferClientCsvInTma;

  if (content.trim() && (await deliverCsvBlob(filename, content, exportPath, preferClient))) {
    return;
  }

  if (exportPath) {
    const fetched = await fetchCsvAuthenticated(exportPath);
    if (!fetched.ok) {
      window.alert(fetched.error);
      return;
    }
    if (await deliverCsvBlob(filename, fetched.csv, exportPath, preferClient)) {
      return;
    }
  }

  window.alert(
    "ดาวน์โหลดไม่สำเร็จ — ลองอัปเดต Telegram หรือใช้ Share / คัดลอกจากปุ่มเดิม",
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
