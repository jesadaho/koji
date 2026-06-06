export function AutoOpenMexcActiveBadge({ active }: { active?: boolean }) {
  if (!active) return null;
  return (
    <span
      className="sub"
      style={{
        display: "inline-block",
        marginLeft: "0.25rem",
        fontSize: "0.82em",
        fontWeight: 700,
        color: "var(--ok, #3a8)",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
      title="ยังมี position เปิดอยู่บน MEXC (แถวเปิดสำเร็จล่าสุดของเหรียญ+ทิศนี้)"
      aria-label="MEXC active"
    >
      ● MEXC
    </span>
  );
}
