import { computeSlTriggerPrice } from "@/lib/tpSlBreakevenPlan";
import { fetchContractDetailPublic, roundMexcPrice } from "./mexcFuturesClient";

/** ราคา trigger SL บังทุน ปัดตาม tick MEXC */
export async function mexcSlBreakevenTriggerPrice(
  contractSymbol: string,
  side: "long" | "short",
  entry: number,
  offsetPct: number,
): Promise<number> {
  const raw = computeSlTriggerPrice(side, entry, offsetPct);
  if (!(raw > 0)) return NaN;
  const detail = await fetchContractDetailPublic(contractSymbol.trim());
  if (detail) {
    const rounded = roundMexcPrice(raw, detail);
    if (rounded > 0) return rounded;
  }
  return raw;
}
