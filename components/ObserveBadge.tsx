export function ObserveBadge({ title }: { title?: string }) {
  return (
    <span
      className="sub"
      style={{
        display: "block",
        fontSize: "0.82em",
        fontWeight: 600,
        color: "#94a3b8",
        marginTop: "0.12rem",
        whiteSpace: "nowrap",
      }}
      title={
        title ??
        "เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram"
      }
    >
      👁 Observe
    </span>
  );
}
