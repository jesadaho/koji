import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  /** แสดงลิงก์หน้าแรกก่อน Snowball/Reversal */
  showHome?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** ลิงก์สถิติ Snowball + Reversal — ใช้ซ้ำใน Mini App / LIFF */
export function MiniAppStatsNav({ showHome = false, className = "sub tmaQuickNav", style }: Props): ReactNode {
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
      <Link href="/snowball-stats">สถิติ Snowball</Link>
      <span className="siteNavSep" aria-hidden>
        |
      </span>
      <Link href="/reversal-stats">สถิติ Reversal</Link>
    </p>
  );
}
