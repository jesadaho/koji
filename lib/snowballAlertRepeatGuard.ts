import type { SnowballStatsRow } from "@/lib/snowballStatsClient";

/** Cooldown / pending guard สำหรับแจ้ง Snowball ซ้ำ — default 48 ชม. (ตรง horizon สถิติ) */
export function snowballAlertRepeatGuardMs(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_COOLDOWN_MS);
  if (Number.isFinite(v) && v > 0) return v;
  return 48 * 3600 * 1000;
}

export type SnowballFeedSideToken = "BULL" | "BEAR";

export function snowballFeedNotifyKey(
  symbol: string,
  snowTf: string,
  side: "long" | "bear" | SnowballFeedSideToken,
): string {
  const sym = symbol.trim().toUpperCase();
  const dir: SnowballFeedSideToken =
    side === "bear" || side === "BEAR" ? "BEAR" : "BULL";
  return `${sym}|SNOWBALL|${snowTf}|${dir}`;
}

export function snowballFeedNotifyKeyFromStatsRow(
  row: Pick<SnowballStatsRow, "symbol" | "alertSide" | "triggerKind" | "signalBarTf">,
): string | null {
  const sym = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
  if (!sym) return null;
  const tf = row.signalBarTf ?? "4h";
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  return snowballFeedNotifyKey(sym, tf, side);
}
