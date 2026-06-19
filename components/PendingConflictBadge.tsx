import { pendingConflictBadgeText } from "@/lib/signalPendingConflict";

export function PendingConflictBadge({
  conflictWith,
}: {
  conflictWith?: string | null;
}) {
  const text = pendingConflictBadgeText(conflictWith);
  if (!text) return null;
  return (
    <span
      className="sub"
      style={{
        display: "block",
        fontSize: "0.82em",
        fontWeight: 600,
        color: "#f59e0b",
        marginTop: "0.12rem",
        whiteSpace: "nowrap",
      }}
      title={`เคย conflict กับ ${conflictWith} ตอนแจ้ง — ไม่ skip/ปิด auto-open (Snowball ↔ Reversal เปิดได้อิสระ)`}
    >
      {text}
    </span>
  );
}
