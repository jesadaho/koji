/** ข้อความที่ส่งจากปุ่ม Flex ต้องตรงกับค่าเหล่านี้ (หรือ alias ภาษาอังกฤษด้านล่าง) */
export const SYSTEM_CHANGE_CMD_ON_TH = "ติดตามระบบ";
export const SYSTEM_CHANGE_CMD_OFF_TH = "เลิกติดตามระบบ";

export type SystemChangeSubscribeParse = "on" | "off" | null;

/** รับรู้คำสั่งเปิด/ปิดแจ้งเตือน System conditions (funding / order limits) */
export function parseSystemChangeSubscribeCommand(text: string): SystemChangeSubscribeParse {
  const t = text.trim();
  if (t === SYSTEM_CHANGE_CMD_ON_TH) return "on";
  if (t === SYSTEM_CHANGE_CMD_OFF_TH) return "off";
  const l = t.toLowerCase();
  if (l === "follow system" || l === "system conditions on") return "on";
  if (l === "unfollow system" || l === "system conditions off") return "off";
  return null;
}
