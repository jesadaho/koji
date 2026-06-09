import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  showHome?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** เมนูหลัก Mini App — Markets / Stats / Trade / Settings */
export function MiniAppMainNav({
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
      <Link href="/markets">Markets</Link>
      <span className="siteNavSep" aria-hidden>
        |
      </span>
      <Link href="/stats">Stats</Link>
      <span className="siteNavSep" aria-hidden>
        |
      </span>
      <Link href="/trade">Trade</Link>
      <span className="siteNavSep" aria-hidden>
        |
      </span>
      <Link href="/settings">Settings</Link>
    </p>
  );
}
