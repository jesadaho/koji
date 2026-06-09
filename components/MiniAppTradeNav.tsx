import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  showHome?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** ลิงก์ Trade — ประวัติ Bot Trade บน MEXC */
export function MiniAppTradeNav({
  showHome = false,
  className = "sub tmaQuickNav",
  style,
}: Props): ReactNode {
  return (
    <p className={className} style={style}>
      {showHome ? (
        <>
          <Link href="/">หน้าแรก</Link>
          <span className="siteNavSep" aria-hidden>
            |
          </span>
        </>
      ) : null}
      <Link href="/trade/bot-trade">ประวัติ Bot Trade</Link>
    </p>
  );
}
