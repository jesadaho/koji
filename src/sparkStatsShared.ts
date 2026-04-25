/**
 * Types + constants สำหรับ Spark stats / LIFF — ไม่ import store (Node/fs)
 * ใช้จาก client components ได้
 */
import type { SparkMcapBand, SparkVolBand } from "./sparkTierContext";

/** จุดวัดผลสถิติเงียบแรกหลัง refClose (นาที) — follow-up แรก = T+นาทีนี้ (เดิม 15) */
export const SPARK_FIRST_FOLLOWUP_MINUTES = 10;

export type SparkHorizonId = "m10m" | "m30m" | "m1h" | "m2h" | "m3h" | "m4h";

export const SPARK_STATS_HORIZON_ORDER: SparkHorizonId[] = ["m10m", "m30m", "m1h", "m2h", "m3h", "m4h"];

export const SPARK_STATS_HORIZON_LABELS: Record<SparkHorizonId, string> = {
  m10m: "10m",
  m30m: "30m",
  m1h: "1h",
  m2h: "2h",
  m3h: "3h",
  m4h: "4h",
};

export type SparkHorizonCell = {
  wins: number;
  total: number;
  /** 0–100 หรือ null เมื่อ total === 0 */
  rate: number | null;
};

export type SparkMatrixRowVol = {
  band: SparkVolBand;
  labelTh: string;
  horizons: Record<SparkHorizonId, SparkHorizonCell>;
};

export type SparkMatrixRowMcap = {
  band: SparkMcapBand;
  labelTh: string;
  horizons: Record<SparkHorizonId, SparkHorizonCell>;
};

/** ชื่อเหรียญ (สั้น) + จำนวนครั้งที่ปรากฏใน log / history */
export type SparkSymbolCount = {
  /** สัญลักษณ์สัญญา เช่น BTC_USDT — ใช้เป็น key */
  symbol: string;
  /** แสดงผล เช่น BTC */
  label: string;
  count: number;
};

/** Win-rate แยกตามเหรียญ (เหตุการณ์ follow-up ที่จบแล้วเท่านั้น) */
export type SparkSymbolMatrixRow = {
  symbol: string;
  label: string;
  /** จำนวนเหตุการณ์ที่ใช้คำนวณแถวนี้ */
  eventCount: number;
  horizons: Record<SparkHorizonId, SparkHorizonCell>;
};

/**
 * เมื่อ matrix ทุกช่องเป็น — อธิบายให้ผู้ใช้เข้าใจ (ไม่ใช่บั๊ก UI)
 * - fire_log_only: มี Spark log แต่ยังไม่มีแถว follow-up จบครบ
 * - history_without_momentum: มีแถว history แต่ทุกช่วง momentum เป็น null
 */
export type SparkMatrixEmptyHint = null | "fire_log_only" | "history_without_momentum";

/** ค่าที่ส่งออกทาง API LIFF (ไม่รวม aggregates ภายในสำหรับข้อความ LINE) */
export type SparkStatsApiPayload = {
  /**
   * false = โฮสต์บน Vercel แต่ยังไม่มี REDIS_URL / Vercel KV — ไม่บันทึก state Spark
   * (แจ้งเตือน Spark ยังทำงาน แต่ log / matrix จะว่าง)
   */
  sparkStatsPersistenceEnabled: boolean;
  /** ทำไม win-rate matrix จึงยังไม่มีตัวเลข (null = ไม่ต้องแสดงคำอธิบายพิเศษ) */
  sparkMatrixEmptyHint: SparkMatrixEmptyHint;
  generatedAt: string;
  historyCount: number;
  pendingCount: number;
  fireLogCount: number;
  upFire: number;
  downFire: number;
  upSpark: number;
  downSpark: number;
  emptyGlobal: boolean;
  matrixByVol: SparkMatrixRowVol[];
  matrixByMcap: SparkMatrixRowMcap[];
  totalHorizons: Record<SparkHorizonId, SparkHorizonCell>;
  /** Spark return > 0 */
  matrixByVolSparkUp: SparkMatrixRowVol[];
  matrixByMcapSparkUp: SparkMatrixRowMcap[];
  totalHorizonsSparkUp: Record<SparkHorizonId, SparkHorizonCell>;
  /** Spark return < 0 */
  matrixByVolSparkDown: SparkMatrixRowVol[];
  matrixByMcapSparkDown: SparkMatrixRowMcap[];
  totalHorizonsSparkDown: Record<SparkHorizonId, SparkHorizonCell>;
  recentFireLines: string[];
  pendingLines: string[];
  historyTailLines: string[];
  /** นับจาก Spark fire log (รายการล่าสุดตาม env — อาจไม่ครบ lifetime) */
  sparkFireLogBySymbol: SparkSymbolCount[];
  /** นับจาก follow-up ที่จบแล้ว (เหตุการณ์ละ 1 แถว) */
  followUpHistoryBySymbol: SparkSymbolCount[];
  /** momentum win-rate ตาม T+… แยกรายสัญญา (เรียงจาก n มากไปน้อย) */
  matrixBySymbol: SparkSymbolMatrixRow[];
  matrixBySymbolSparkUp: SparkSymbolMatrixRow[];
  matrixBySymbolSparkDown: SparkSymbolMatrixRow[];
};
