/** เซสชันเทรด: เริ่ม 07:00 น. ตาม Asia/Bangkok จนถึง 07:00 วันถัดไป */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ปี เดือน วัน ชั่วโมง ใน Asia/Bangkok */
export function bkkYmdh(d: Date): { y: number; m: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function civilMinusOneDay(y: number, m: number, day: number): { y: number; m: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * รหัสเซสชัน YYYY-MM-DD — ช่วง [D 07:00, D+1 07:00) ในเวลาไทย ใช้วันที่ D ของเซสชันที่เริ่ม 07:00
 * ก่อน 07:00 ของวันปฏิทิน = ยังอยู่ในเซสชันที่เริ่มเมื่อวาน 07:00
 */
export function bkkTradingSessionId(now: Date): string {
  const { y, m, day, hour } = bkkYmdh(now);
  if (hour < 7) {
    const p = civilMinusOneDay(y, m, day);
    return `${p.y}-${pad2(p.m)}-${pad2(p.day)}`;
  }
  return `${y}-${pad2(m)}-${pad2(day)}`;
}
