import type { FlexBubble } from "@line/bot-sdk";

export const KOJI_MENU_ALT_TEXT = "Koji — เปิดแอป, Market, ช่วยเหลือ";

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
            ? "แตะปุ่มด้านล่างเพื่อเปิดแอป ดู Markets หรืออ่านคำสั่ง"
            : "แตะช่วยเหลือเพื่อดูคำสั่ง — ตั้งค่า LIFF บนเซิร์ฟเวอร์เพื่อลิงก์เปิดแอป/Market",
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
