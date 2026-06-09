import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  showHome?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** ลิงก์ Backtest Snowball + Reversal — ใช้ซ้ำใน Mini App / LIFF */
export function MiniAppBacktestNav({
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
      <Link href="/snowball-backtest">Backtest Snowball</Link>
      <span className="siteNavSep" aria-hidden>
        |
      </span>
      <Link href="/reversal-backtest">Backtest Reversal</Link>
    </p>
  );
}
