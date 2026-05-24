#!/usr/bin/env node
/**
 * ล้าง breakout1hConfirmFail บนแถว Master 4h (ป้าย legacy ไม่ใช้กับ two-bar 4H)
 *
 * Usage (จาก root โปรเจกต์):
 *   node scripts/clear-snowball-4h-breakout1h-confirm-fail.mjs
 *   node scripts/clear-snowball-4h-breakout1h-confirm-fail.mjs --dry-run
 *
 * อ่าน/เขียน storage เดียวกับ snowballStatsStore:
 *   - REDIS_URL หรือ KV_REST_* → cloud key koji:snowball_alert_stats
 *   - ไม่มี cloud → data/snowball_alert_stats.json
 *
 * โหลด .env จาก cwd อัตโนมัติ (dotenv)
 */

import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient } from "redis";
import { kv } from "@vercel/kv";

config({ path: join(process.cwd(), ".env") });

const KV_KEY = "koji:snowball_alert_stats";
const FILE_PATH = join(process.cwd(), "data", "snowball_alert_stats.json");
const dryRun = process.argv.includes("--dry-run");

function useRedisUrl() {
  return Boolean(process.env.REDIS_URL?.trim());
}

function useKvRest() {
  return Boolean(process.env.KV_REST_API_URL?.trim());
}

function useCloudStorage() {
  return useRedisUrl() || useKvRest();
}

function storageLabel() {
  if (useRedisUrl()) return `Redis (${KV_KEY})`;
  if (useKvRest()) return `Vercel KV (${KV_KEY})`;
  return FILE_PATH;
}

async function loadState() {
  if (useCloudStorage()) {
    if (useRedisUrl()) {
      const url = process.env.REDIS_URL.trim();
      const client = createClient({ url });
      client.on("error", (err) => console.error("[redis]", err));
      await client.connect();
      try {
        const raw = await client.get(KV_KEY);
        if (raw == null || raw === "") return { rows: [], client };
        const parsed = JSON.parse(raw);
        return {
          rows: Array.isArray(parsed?.rows) ? [...parsed.rows] : [],
          client,
        };
      } catch (e) {
        await client.quit().catch(() => {});
        throw e;
      }
    }
    const data = await kv.get(KV_KEY);
    if (data && Array.isArray(data.rows)) return { rows: [...data.rows], client: null };
    return { rows: [], client: null };
  }

  try {
    const raw = await readFile(FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rows)) return { rows: [...parsed.rows], client: null };
  } catch {
    /* ไม่มีไฟล์ */
  }
  return { rows: [], client: null };
}

async function saveState(rows, redisClient) {
  const payload = { rows };
  if (useRedisUrl() && redisClient) {
    await redisClient.set(KV_KEY, JSON.stringify(payload));
    return;
  }
  if (useKvRest()) {
    await kv.set(KV_KEY, payload);
    return;
  }
  await mkdir(dirname(FILE_PATH), { recursive: true });
  await writeFile(FILE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

function rowMatches(row) {
  return row.signalBarTf === "4h" && row.breakout1hConfirmFail === true;
}

async function main() {
  console.log(`Storage: ${storageLabel()}`);
  if (dryRun) console.log("Mode: --dry-run (ไม่เขียนกลับ)");

  const { rows, client } = await loadState();
  const matches = rows.filter(rowMatches);

  console.log(`แถวทั้งหมด: ${rows.length}`);
  console.log(`แถวที่จะอัปเดต (4h + breakout1hConfirmFail=true): ${matches.length}`);

  if (matches.length > 0) {
    const preview = matches.slice(0, 20);
    for (const r of preview) {
      console.log(
        `  · ${r.symbol} alerted=${r.alertedAtIso ?? r.alertedAtMs} tier=${r.qualityTier ?? "—"}`,
      );
    }
    if (matches.length > 20) {
      console.log(`  … และอีก ${matches.length - 20} แถว`);
    }
  }

  let updated = 0;
  for (const row of rows) {
    if (rowMatches(row)) {
      row.breakout1hConfirmFail = false;
      updated += 1;
    }
  }

  if (updated === 0) {
    console.log("ไม่มีแถวที่ต้องอัปเดต — จบ");
    if (client) await client.quit().catch(() => {});
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] จะตั้ง breakout1hConfirmFail=false ให้ ${updated} แถว (ไม่บันทึก)`);
    if (client) await client.quit().catch(() => {});
    return;
  }

  await saveState(rows, client);
  if (client) await client.quit().catch(() => {});

  console.log(`บันทึกแล้ว — อัปเดต ${updated} แถว → breakout1hConfirmFail=false`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
