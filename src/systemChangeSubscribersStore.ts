import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { kv } from "@vercel/kv";

const KV_KEY = "koji:system_change_subscribers";
const filePath = join(process.cwd(), "data", "system_change_subscribers.json");

function useKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useKv()) {
    throw new Error("บน Vercel ต้องมี Vercel KV สำหรับ system change subscribers");
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "[]", "utf-8");
  }
}

function dedupeSorted(ids: string[]): string[] {
  const u = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)));
  u.sort();
  return u;
}

export async function loadSystemChangeSubscribers(): Promise<string[]> {
  if (useKv()) {
    try {
      const data = await kv.get<string[]>(KV_KEY);
      return Array.isArray(data) ? dedupeSorted(data) : [];
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[systemChangeSubscribersStore] kv.get failed", e);
      throw new Error(`อ่าน KV system_change_subscribers ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return [];
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? dedupeSorted(parsed) : [];
  } catch {
    return [];
  }
}

async function saveSubscribers(ids: string[]): Promise<void> {
  const next = dedupeSorted(ids);
  if (useKv()) {
    await kv.set(KV_KEY, next);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
}

export async function addSystemChangeSubscriber(userId: string): Promise<boolean> {
  const all = await loadSystemChangeSubscribers();
  if (all.includes(userId)) return false;
  await saveSubscribers([...all, userId]);
  return true;
}

export async function removeSystemChangeSubscriber(userId: string): Promise<boolean> {
  const all = await loadSystemChangeSubscribers();
  if (!all.includes(userId)) return false;
  await saveSubscribers(all.filter((id) => id !== userId));
  return true;
}

export async function hasSystemChangeSubscriber(userId: string): Promise<boolean> {
  const all = await loadSystemChangeSubscribers();
  return all.includes(userId);
}
