import type { FlexBubble } from "@line/bot-sdk";
import { BASE_TO_CONTRACT } from "./coinMap";

/** ลำดับเหรียญยอดนิยม (เฉพาะคีย์ที่มีใน BASE_TO_CONTRACT) */
export const HOT_BASE_KEYS = [
  "btc",
  "eth",
  "sol",
  "bnb",
  "xrp",
  "doge",
  "ada",
  "avax",
  "link",
  "sui",
] as const;

export const KOJI_MENU_ALT_TEXT = "Koji — เหรียญยอดนิยม แตะเพื่อดูราคา";

export function buildKojiWelcomeFlexContents(liffId?: string): FlexBubble {
  const keys = HOT_BASE_KEYS.filter((k) => k in BASE_TO_CONTRACT);

  const tokenButtons = keys.map((key) => ({
    type: "button" as const,
    style: "secondary" as const,
    height: "sm" as const,
    action: {
      type: "message" as const,
      label: key.toUpperCase(),
      text: `ราคา ${key}`,
    },
  }));

  const footerContents: NonNullable<FlexBubble["footer"]>["contents"] = [];
  if (liffId) {
    footerContents.push({
      type: "button" as const,
      style: "primary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "เปิดแอป Koji",
        uri: `https://liff.line.me/${liffId}`,
      },
    });
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "Markets Top 25",
        uri: `https://liff.line.me/${liffId}/markets`,
      },
    });
  }
  footerContents.push({
    type: "button" as const,
    style: "link" as const,
    height: "sm" as const,
    action: {
      type: "message" as const,
      label: "ช่วยเหลือ",
      text: "ช่วยเหลือ",
    },
  });

  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      backgroundColor: "#06C755",
      contents: [
        {
          type: "text",
          text: "Koji",
          weight: "bold",
          size: "xl",
          color: "#FFFFFF",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "เหรียญยอดนิยม",
          weight: "bold",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: "แตะชื่อเหรียญเพื่อดูราคา (MEXC Futures USDT)",
          size: "xs",
          color: "#888888",
          wrap: true,
        },
        ...tokenButtons,
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: footerContents,
    },
  };
}
