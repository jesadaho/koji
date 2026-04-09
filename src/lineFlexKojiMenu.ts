import type { FlexBubble } from "@line/bot-sdk";
import { SYSTEM_CHANGE_CMD_OFF_TH, SYSTEM_CHANGE_CMD_ON_TH } from "./systemChangeLineCommands";

export const KOJI_MENU_ALT_TEXT =
  "Koji — เปิดแอป, Market, Top 50 Funding, Settings (ติดตามระบบ), ติดตาม/เลิกติดตามระบบ (เมื่อไม่มี LIFF), ช่วยเหลือ";

export function buildKojiWelcomeFlexContents(liffId?: string): FlexBubble {
  const footerContents: NonNullable<FlexBubble["footer"]>["contents"] = [];

  if (liffId) {
    footerContents.push({
      type: "button" as const,
      style: "primary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "เปิดแอป",
        uri: `https://liff.line.me/${liffId}`,
      },
    });
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "Market",
        uri: `https://liff.line.me/${liffId}/markets`,
      },
    });
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "Top 50 Funding rate",
        uri: `https://liff.line.me/${liffId}/markets?sort=funding`,
      },
    });
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "uri" as const,
        label: "ตั้งค่า (ติดตามระบบ)",
        uri: `https://liff.line.me/${liffId}/settings`,
      },
    });
  } else {
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "message" as const,
        label: "ติดตามระบบ",
        text: SYSTEM_CHANGE_CMD_ON_TH,
      },
    });
    footerContents.push({
      type: "button" as const,
      style: "secondary" as const,
      height: "sm" as const,
      action: {
        type: "message" as const,
        label: "เลิกติดตามระบบ",
        text: SYSTEM_CHANGE_CMD_OFF_TH,
      },
    });
  }

  footerContents.push({
    type: "button" as const,
    style: liffId ? ("link" as const) : ("primary" as const),
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
          text: "แจ้งเตือนราคา MEXC Futures (USDT)",
          weight: "bold",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: liffId
            ? "แตะปุ่มด้านล่าง — เปิดแอป / Market (Momentum) / Top 50 Funding rate / ตั้งค่า (ติดตาม System conditions) / ช่วยเหลือ"
            : "ติดตามระบบ = แจ้งเมื่อ funding หรือขนาดออเดอร์เปลี่ยน (ไม่ต้องเลือกเหรียญ) · ตั้ง LIFF เพื่อเปิดแอป/Market/ตั้งค่า",
          size: "xs",
          color: "#888888",
          wrap: true,
        },
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
