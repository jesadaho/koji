import type { Metadata } from "next";
import Link from "next/link";
import { getUpcomingEventsForDisplay } from "@/src/upcomingEventsService";
import { finnhubCalendarConfigured } from "@/src/finnhubEconomicCalendar";
import type { UnifiedEvent } from "@/src/upcomingEventsTypes";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Upcoming events — High-impact macro & unlocks",
  description:
    "US macro (CPI / FOMC / NFP) · token unlocks ตาม % circ. · network/listing — ข้อมูลอ้างอิง ไม่ใช่คำแนะนำลงทุน",
};

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function Row({ e }: { e: UnifiedEvent }) {
  const imp = e.importance === "high" ? " (high)" : "";
  const pct = e.meta?.pctCirculating;
  const extra =
    pct != null && Number.isFinite(pct)
      ? ` · ${pct.toFixed(2)}% circ.`
      : e.meta?.network
        ? ` · ${e.meta.network}`
        : "";
  return (
    <tr>
      <td>{formatUtc(e.startsAtUtc)}</td>
      <td>{e.category}</td>
      <td>{e.country ?? e.meta?.exchange ?? "—"}</td>
      <td>
        {e.title}
        {imp}
        {extra}
      </td>
      <td>{e.forecast ?? "—"}</td>
      <td>{e.actual ?? "—"}</td>
      <td>{e.source}</td>
    </tr>
  );
}

export default async function UpcomingEventsPage() {
  const snap = await getUpcomingEventsForDisplay();
  const hasFinnhub = finnhubCalendarConfigured();
  const hasUnlocks = Boolean(process.env.TOKEN_UNLOCKS_API_URL?.trim());
  const hasCryptoInfra = Boolean(process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim());

  const macro = snap.events.filter((e) => e.category === "macro");
  const unlocks = snap.events.filter((e) => e.category === "unlock");
  const infra = snap.events.filter((e) => e.category === "crypto_infra");

  return (
    <main className="settingsPage" style={{ maxWidth: "min(1100px, 100%)", margin: "0 auto", padding: "1rem" }}>
      <h1>Upcoming events</h1>
      <p className="sub">
        ช่วงข้อมูล: {snap.rangeFromIso.slice(0, 10)} → {snap.rangeToIso.slice(0, 10)} · อัปเดตล่าสุด{" "}
        {snap.fetchedAtIso}
      </p>
      <p className="sub">
        แสดงเฉพาะ high-impact: US macro ตัวตึง (CPI / PPI / PCE · FOMC · NFP) · unlock เมื่อทราบ % ของ circulating ≥
        เกณฑ์ · network/listing จาก API ที่ตั้งค่า
      </p>
      {!hasFinnhub && !hasUnlocks && !hasCryptoInfra && (
        <p className="sub" style={{ color: "var(--warn, #e6b35c)" }}>
          ยังไม่ได้ตั้งแหล่งข้อมูล (อย่างน้อยหนึ่งใน FINNHUB / TOKEN_UNLOCKS / CRYPTO_MARKET_EVENTS)
        </p>
      )}
      <p className="sub">
        Telegram: weekly → <code>TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID</code> · pre →{" "}
        <code>TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID</code> · ผลจริง →{" "}
        <code>TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID</code> · US session →{" "}
        <code>TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID</code>
      </p>

      <h2 style={{ marginTop: "1.5rem" }}>US session (แจ้งเตือนแยก topic)</h2>
      <p className="sub">
        Pre-market / cash open ~<strong>19:30–20:30</strong> น. ไทย · Close / rebalance ~<strong>03:00–04:00</strong> น. ไทย
        — ส่งครั้งต่อวันเมื่อเข้าช่วง (cron 5 นาที)
      </p>

      <h2 style={{ marginTop: "1.5rem" }}>US macro (liquidity / volatility)</h2>
      <div className="marketsTableWrap">
        <table className="marketsTable">
          <thead>
            <tr>
              <th>เวลา (UTC)</th>
              <th>ประเภท</th>
              <th>ประเทศ</th>
              <th>เหตุการณ์</th>
              <th>คาด</th>
              <th>จริง</th>
              <th>แหล่ง</th>
            </tr>
          </thead>
          <tbody>
            {macro.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  ไม่มีข้อมูล
                </td>
              </tr>
            ) : (
              macro.map((e: UnifiedEvent) => <Row key={e.id} e={e} />)
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Token unlocks (≥ % circulating)</h2>
      <div className="marketsTableWrap">
        <table className="marketsTable">
          <thead>
            <tr>
              <th>เวลา (UTC)</th>
              <th>ประเภท</th>
              <th>—</th>
              <th>เหตุการณ์</th>
              <th>—</th>
              <th>—</th>
              <th>แหล่ง</th>
            </tr>
          </thead>
          <tbody>
            {unlocks.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  ไม่มีข้อมูลที่ผ่านเกณฑ์ (ต้องมี field % circ. ใน JSON หรือเปิด UPCOMING_UNLOCK_ALLOW_UNKNOWN_PCT)
                </td>
              </tr>
            ) : (
              unlocks.map((e: UnifiedEvent) => <Row key={e.id} e={e} />)
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Network / listing (crypto infra)</h2>
      <div className="marketsTableWrap">
        <table className="marketsTable">
          <thead>
            <tr>
              <th>เวลา (UTC)</th>
              <th>ประเภท</th>
              <th>Exchange / network</th>
              <th>เหตุการณ์</th>
              <th>—</th>
              <th>—</th>
              <th>แหล่ง</th>
            </tr>
          </thead>
          <tbody>
            {infra.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  ไม่มีข้อมูล (ตั้ง <code>CRYPTO_MARKET_EVENTS_API_URL</code> — JSON รายการ upgrade / listing)
                </td>
              </tr>
            ) : (
              infra.map((e: UnifiedEvent) => <Row key={e.id} e={e} />)
            )}
          </tbody>
        </table>
      </div>

      <p className="sub" style={{ marginTop: "1.5rem" }}>
        ข้อมูลจาก API บุคคลที่สาม — อาจล่าช้าหรือคลาดเคลื่อน — ไม่ใช่คำแนะนำลงทุน
      </p>
      <p>
        <Link href="/">← Home</Link>
      </p>
    </main>
  );
}
