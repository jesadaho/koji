import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Koji — จัดการแจ้งเตือน",
  description: "MEXC Futures — จัดการแจ้งเตือนราคา",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0f14",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>
        <nav className="siteNav" aria-label="หลัก">
          <Link href="/">Home</Link>
          <span className="siteNavSep" aria-hidden>
            |
          </span>
          <Link href="/markets">Markets</Link>
          <span className="siteNavSep" aria-hidden>
            |
          </span>
          <Link href="/snowball-stats">Snowball</Link>
          <span className="siteNavSep" aria-hidden>
            |
          </span>
          <Link href="/upcoming-events">Events</Link>
          <span className="siteNavSep" aria-hidden>
            |
          </span>
          <Link href="/settings">Settings</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
