import { randomBytes } from "node:crypto";

const TTL_MS = 120_000;
const MAX_CSV_BYTES = 3 * 1024 * 1024;

type StagedCsvRow = {
  csv: string;
  filename: string;
  expMs: number;
};

const store = new Map<string, StagedCsvRow>();

function storeKey(telegramUserId: number, stagingId: string): string {
  return `${Math.floor(telegramUserId)}:${stagingId}`;
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expMs <= now) store.delete(k);
  }
}

export function putTmaStagedCsv(
  telegramUserId: number,
  csv: string,
  filename: string,
): { stagingId: string } | { error: string } {
  purgeExpired();
  if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
    return { error: "invalid_user" };
  }
  const text = typeof csv === "string" ? csv : "";
  if (!text.trim()) return { error: "empty_csv" };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_CSV_BYTES) return { error: "csv_too_large" };
  const name =
    typeof filename === "string" && filename.trim()
      ? filename.trim().replace(/[^\w.\-]+/g, "_")
      : "export.csv";
  const stagingId = randomBytes(12).toString("base64url");
  store.set(storeKey(telegramUserId, stagingId), {
    csv: text,
    filename: name.endsWith(".csv") ? name : `${name}.csv`,
    expMs: Date.now() + TTL_MS,
  });
  return { stagingId };
}

/** ดึงครั้งเดียว (one-time) หลัง download */
export function consumeTmaStagedCsv(
  telegramUserId: number,
  stagingId: string,
): { csv: string; filename: string } | null {
  purgeExpired();
  const id = typeof stagingId === "string" ? stagingId.trim() : "";
  if (!id) return null;
  const key = storeKey(telegramUserId, id);
  const row = store.get(key);
  store.delete(key);
  if (!row || row.expMs <= Date.now()) return null;
  return { csv: row.csv, filename: row.filename };
}
