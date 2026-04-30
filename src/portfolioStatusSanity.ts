/**
 * Manual / quick sanity: `npx ts-node src/portfolioStatusSanity.ts` (or run from a REPL)
 * ไม่ถูก import จาก production path
 */
import { describeSwingStructureFromCloses, formatMarginRatioDisplay } from "./portfolioStatusService";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[portfolioStatusSanity] ${msg}`);
}

const s1 = describeSwingStructureFromCloses([10, 11, 12, 11, 10, 11, 12, 13, 12, 11]);
assert(s1.length > 0 && s1.includes("heuristic"), "swing string");

assert(formatMarginRatioDisplay(0.125) === "12.50%", "margin ratio 0–1");
assert(formatMarginRatioDisplay(12.5) === "12.50%", "margin ratio as percent");

console.log("portfolioStatusSanity: ok", s1);
