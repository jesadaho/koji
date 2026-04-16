/**
 * Types + constants สำหรับ Spark stats / LIFF — ไม่ import store (Node/fs)
 * ใช้จาก client components ได้
 */
import type { SparkMcapBand, SparkVolBand } from "./sparkTierContext";

export type SparkHorizonId = "m15m" | "m30m" | "m1h" | "m2h" | "m3h" | "m4h";

export const SPARK_STATS_HORIZON_ORDER: SparkHorizonId[] = ["m15m", "m30m", "m1h", "m2h", "m3h", "m4h"];

export const SPARK_STATS_HORIZON_LABELS: Record<SparkHorizonId, string> = {
  m15m: "15m",
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

/** ค่าที่ส่งออกทาง API LIFF (ไม่รวม aggregates ภายในสำหรับข้อความ LINE) */
export type SparkStatsApiPayload = {
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
};
