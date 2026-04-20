import type { Metadata } from "next";
import Link from "next/link";
import { getUpcomingEventsForDisplay } from "@/src/upcomingEventsService";
import { finnhubCalendarConfigured } from "@/src/finnhubEconomicCalendar";
import type { UnifiedEvent } from "@/src/upcomingEventsTypes";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Upcoming events — Macro & unlocks",
  description: "ปฏิทินเหตุการณ์เศรษฐกิจ (Finnhub) และ token unlocks — ข้อมูลอ้างอิง ไม่ใช่คำแนะนำลงทุน",
};

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function Row({ e }: { e: UnifiedEvent }) {
  const imp = e.importance === "high" ? " (high)" : "";
  return (
    <tr>
      <td>{formatUtc(e.startsAtUtc)}</td>
      <td>{e.category}</td>
      <td>{e.country ?? "—"}</td>
      <td>
        {e.title}
        {imp}
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

  const macro = snap.events.filter((e) => e.category === "macro");
  const unlocks = snap.events.filter((e) => e.category === "unlock");

  return (
    <main className="settingsPage" style={{ maxWidth: "min(1100px, 100%)", margin: "0 auto", padding: "1rem" }}>
      <h1>Upcoming events</h1>
      <p className="sub">
        ช่วงข้อมูล: {snap.rangeFromIso.slice(0, 10)} → {snap.rangeToIso.slice(0, 10)} · อัปเดตล่าสุด{" "}
        {snap.fetchedAtIso}
      </p>
      {!hasFinnhub && !hasUnlocks && (
        <p className="sub" style={{ color: "var(--warn, #e6b35c)" }}>
          ยังไม่ได้ตั้ง <code>FINNHUB_API_KEY</code> หรือ <code>TOKEN_UNLOCKS_API_URL</code> — ตารางจะว่างจนกว่าจะตั้งค่า
        </p>
      )}
      <p className="sub">
        แจ้งเตือน Telegram: weekly digest → topic <code>TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID</code> ·
        pre-event → <code>TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID</code> · ผลจริง →{" "}
        <code>TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID</code> (หรือ fallback condition)
      </p>

      <h2 style={{ marginTop: "1.5rem" }}>Macro</h2>
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

      <h2 style={{ marginTop: "1.5rem" }}>Token unlocks</h2>
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
                  ไม่มีข้อมูล (ตั้ง <code>TOKEN_UNLOCKS_API_URL</code> ให้ชี้ API ที่คืน JSON รายการ unlock)
                </td>
              </tr>
            ) : (
              unlocks.map((e: UnifiedEvent) => <Row key={e.id} e={e} />)
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
