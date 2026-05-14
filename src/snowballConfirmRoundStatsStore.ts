import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:snowball_confirm_last_round_stats";
const filePath = join(process.cwd(), "data", "snowball_confirm_last_round_stats.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ snowball confirm last round stats"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ atIso: "", confirmed: [], failed: [], tgFailed: [] } satisfies SnowballConfirmLastRoundStats, null, 2),
      "utf-8"
    );
  }
}

/** ผลรอบล่าสุดของ runSnowballConfirmFollowUpTick — ให้สรุปสแกน Snowball อ่านแสดงต่อท้าย */
export type SnowballConfirmLastRoundStats = {
  atIso: string;
  /** เช่น "BTCUSDT LONG" — แท่ง 2 ปิดผ่านราคา+vol และส่ง TG สำเร็จ */
  confirmed: string[];
  /** แท่ง 2 ปิดแล้วแต่ราคา/vol ไม่ผ่าน (หรือข้อมูลแท่งไม่ครบ) */
  failed: string[];
  /** ผ่านราคา+vol แต่ส่ง Telegram ไม่สำเร็จ */
  tgFailed: string[];
};

function normalizeStats(raw: unknown): SnowballConfirmLastRoundStats {
  const empty: SnowballConfirmLastRoundStats = { atIso: "", confirmed: [], failed: [], tgFailed: [] };
  if (!raw || typeof raw !== "object") return empty;
  const o = raw as Record<string, unknown>;
  const atIso = typeof o.atIso === "string" ? o.atIso : "";
  const pick = (k: "confirmed" | "failed" | "tgFailed"): string[] => {
    const a = o[k];
    if (!Array.isArray(a)) return [];
    const out: string[] = [];
    for (const x of a) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
    return out;
  };
  return {
    atIso,
    confirmed: pick("confirmed"),
    failed: pick("failed"),
    tgFailed: pick("tgFailed"),
  };
}

export async function loadSnowballConfirmLastRoundStats(): Promise<SnowballConfirmLastRoundStats> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SnowballConfirmLastRoundStats>(KV_KEY);
      return normalizeStats(data);
    } catch (e) {
      console.error("[snowballConfirmRoundStatsStore] cloud get failed", e);
      throw e;
    }
  }
  if (isVercel()) {
    return { atIso: "", confirmed: [], failed: [], tgFailed: [] };
  }
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeStats(JSON.parse(raw) as unknown);
  } catch {
    return { atIso: "", confirmed: [], failed: [], tgFailed: [] };
  }
}

export async function saveSnowballConfirmLastRoundStats(stats: SnowballConfirmLastRoundStats): Promise<void> {
  const normalized = normalizeStats(stats);
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, normalized);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}
