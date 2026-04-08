/** ข้อความที่ส่งจากปุ่ม Flex ต้องตรงกับค่าเหล่านี้ (หรือ alias ภาษาอังกฤษด้านล่าง) */
export const SYSTEM_CHANGE_CMD_ON_TH = "ติดตามระบบ";
export const SYSTEM_CHANGE_CMD_OFF_TH = "เลิกติดตามระบบ";

export type SystemChangeSubscribeParse = "on" | "off" | null;

/** แฮชแบบ #subscribeSystem / #unsubscribeSystem (ไม่สนตัวพิมพ์) — อนุญาตท้ายด้วยจุด/ช่องว่าง */
function matchesHashSubscribe(s: string): SystemChangeSubscribeParse {
  if (/^#subscribesystem[^a-z0-9]*$/i.test(s)) return "on";
  if (/^#unsubscribesystem[^a-z0-9]*$/i.test(s)) return "off";
  return null;
}

/** รับรู้คำสั่งเปิด/ปิดแจ้งเตือน System conditions (funding / order limits) */
export function parseSystemChangeSubscribeCommand(text: string): SystemChangeSubscribeParse {
  const t = text.trim();
  if (t === SYSTEM_CHANGE_CMD_ON_TH) return "on";
  if (t === SYSTEM_CHANGE_CMD_OFF_TH) return "off";
  const hash = matchesHashSubscribe(t);
  if (hash) return hash;
  const l = t.toLowerCase();
  if (l === "follow system" || l === "system conditions on") return "on";
  if (l === "unfollow system" || l === "system conditions off") return "off";
  return null;
}

/** สอบถามสถานะติดตามระบบ — รวม #systemStatus */
export function isSystemSubscribeStatusQuery(text: string): boolean {
  const l = text.trim().toLowerCase();
  if (l === "สถานะติดตามระบบ" || l === "system status") return true;
  return /^#systemstatus[^a-z0-9]*$/i.test(text.trim());
}
