import { isAdminLineUserId } from "./adminIds";

/** สอบถามสถิติ Spark follow-up */
export function isSparkStatsQuery(text: string): boolean {
  const t = text.trim();
  const l = t.toLowerCase();
  if (l === "สถิติ spark" || l === "spark stats" || l === "spark follow-up" || l === "spark followup") {
    return true;
  }
  return /^#sparkstats[^a-z0-9]*$/i.test(t);
}

/** ล้าง state Spark matrix / follow-up (ต้องอนุญาตด้วย env SPARK_MATRIX_RESET_ALLOWED_USER_IDS) */
export function isSparkMatrixResetCommand(text: string): boolean {
  const t = text.trim();
  const l = t.toLowerCase();
  if (
    l === "ล้างสถิติ spark" ||
    l === "ล้าง spark matrix" ||
    l === "reset spark matrix" ||
    l === "cleanup spark matrix" ||
    l === "spark matrix reset"
  ) {
    return true;
  }
  return /^#sparkreset$/i.test(t);
}

/** อนุญาตเฉพาะ userId ที่ระบุใน env (คั่นด้วยจุลภาค) */
export function isSparkMatrixResetAllowed(userId: string): boolean {
  return isAdminLineUserId(userId);
}
