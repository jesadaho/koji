import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import {
  classifyLongStructureTier,
  resolveSnowballLongFinalGrade,
  snowballLongGradeDisplayLabel,
  snowballLongGradeShortLabel,
  snowballLongStructurePassesMain,
  snowballTfBarDurationSec,
  type SnowballLongGradeResolution,
} from "./snowballLongBreakoutGrade";
import { countSnowball4hMomentumFails } from "./snowballLongGrade4hPipeline";
import {
  classifySnowballStructureCeiling,
  resolveSnowballLong4hGradeMatrix,
  snowballActionPlanLabel,
} from "./snowballLongGradeMatrix";
import {
  calculateTrendMomentumMetrics,
  snowballGradeBRequiresSustainedMomentum,
  snowballGradeBMomentumFailGradeDOn1hConfirmPass,
  snowballGradeBNearMissVolumeEnabled,
  snowballGradeFOnMomentumAnd1hConfirmFail,
  snowballTrendMomentumMaxDrawbackPct,
  snowballTrendMomentumMaxVolumeDrops,
  SNOWBALL_TREND_15M_DD_LOOKBACK,
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
} from "./snowballTrendMomentumMetrics";
import {
  evaluateSnowballTwoBarInlineLong,
  snowballConfirmVolMinRatio,
  snowballMinLow1hBetweenClosedBars,
  snowballTwoBarInlinePullbackMaxFrac,
} from "./snowballTwoBarInline";

export type Snowball4hStagedDebugInput = {
  symbol: string;
  snowTf: BinanceIndicatorTf;
  iSig: number;
  iConf: number;
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  timeSec: number[];
  pack1h: BinanceKlinePack | null;
  pack15m?: BinanceKlinePack | null;
  swingLb: number;
  swingGradeLb: number;
  swingEx: number;
  priorMaxHigh: number | null;
  priorMaxHighGrade?: number | null;
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  vahHigh: number | null;
  longVahOn: boolean;
  longSlopeEmaOn: boolean;
  longSlopeEmaP: number;
  longSlopeMinUpBars: number;
  emaSlopeOk: boolean;
  longEma2On: boolean;
  longEma2P: number;
  ema2SlopeOk: boolean;
  longRequireInnerHvnClear: boolean;
  innerHvnCleared: boolean;
  innerHvnHigh: number | null;
  volMult: number;
  volNearMult: number;
  volStrictOk: boolean;
  volNearMissOnly: boolean;
  signalVolVsSma: number | null;
};

function pairSlash(sym: string): string {
  const s = sym.trim().toUpperCase().replace(/^@/, "");
  const base = s.endsWith("USDT") ? s.slice(0, -4) : s;
  return `${base}/USDT`;
}

function fmtPx(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return p.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(digits);
}

function stageMark(ok: boolean): string {
  return ok ? "✓" : "❌";
}

function finalGradeLine(res: SnowballLongGradeResolution): string {
  if (res.kind === "block") {
    if (res.reason === "structure_fail") return "BLOCK (Stage 1 — โครงสร้าง 4H)";
    if (res.reason === "two_bar_inline_fail") return "BLOCK (Stage 2 — two-bar inline)";
    return `BLOCK (${res.reason})`;
  }
  return snowballLongGradeDisplayLabel(res.grade);
}

export function formatSnowball4hStagedDebugChecklist(input: Snowball4hStagedDebugInput): string {
  const {
    symbol,
    snowTf,
    iSig,
    iConf,
    close,
    high,
    low,
    volume,
    timeSec,
    pack1h,
    swingLb,
    swingGradeLb,
    priorMaxHigh,
    priorMaxHighGrade,
    swing48,
    swing200,
    vahOk,
    vahHigh,
    longVahOn,
    longSlopeEmaOn,
    longSlopeEmaP,
    emaSlopeOk,
    longEma2On,
    longEma2P,
    ema2SlopeOk,
    longRequireInnerHvnClear,
    innerHvnCleared,
    innerHvnHigh,
    volMult,
    volNearMult,
    volStrictOk,
    signalVolVsSma,
  } = input;

  const sigH = high[iSig]!;
  const sigL = low[iSig]!;
  const sigC = close[iSig]!;
  const confC = close[iConf]!;
  const sigV = volume[iSig]!;
  const confV = volume[iConf]!;
  const range = sigH - sigL;
  const frac = snowballTwoBarInlinePullbackMaxFrac();
  const vr = snowballConfirmVolMinRatio();
  const dur = snowballTfBarDurationSec(snowTf);
  const sigOpen = timeSec[iSig]!;
  const confEnd = timeSec[iConf]! + dur;

  const structureMain = snowballLongStructurePassesMain(swing48, vahOk);
  const emaTrendOk =
    (!longSlopeEmaOn || emaSlopeOk) && (!longEma2On || ema2SlopeOk);
  const innerOk = !longRequireInnerHvnClear || innerHvnCleared;
  const stage1Pass = structureMain && emaTrendOk && innerOk;

  const twoBar = evaluateSnowballTwoBarInlineLong({
    close,
    high,
    low,
    volume,
    timeSec,
    iSig,
    iConf,
    snowTf,
    pack1h,
  });
  const stage2Pass = twoBar.ok;

  const pullbackPct =
    range > 0 && Number.isFinite(sigC) && Number.isFinite(confC) && confC < sigC
      ? ((sigC - confC) / range) * 100
      : 0;
  const volRatio = sigV > 0 && Number.isFinite(confV) ? confV / sigV : NaN;
  let minL: number | null = null;
  if (pack1h?.timeSec?.length) {
    minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
  }

  const trendMomentum = calculateTrendMomentumMetrics(pack1h, { pack15m: input.pack15m ?? null });
  const pipelineInput = {
    swing48: input.swing48,
    swing200: input.swing200,
    vahOk: input.vahOk,
    twoBar,
    trendMomentum,
    signalVolVsSma: input.signalVolVsSma,
    volumeStrictOk: volStrictOk,
  };
  const { failCount, ddOk, volCascadeOk } = countSnowball4hMomentumFails(pipelineInput);
  const stage1Ceiling = classifySnowballStructureCeiling({
    swing48: input.swing48,
    swing200: input.swing200,
    vahOk: input.vahOk,
  });
  const matrixResult = resolveSnowballLong4hGradeMatrix({
    swing48: input.swing48,
    swing200: input.swing200,
    vahOk: input.vahOk,
    ddOk,
    volCascadeOk,
    volStrictOk,
  });

  const gradeRes = resolveSnowballLongFinalGrade({
    snowTf,
    swing48: input.swing48,
    swing200: input.swing200,
    vahOk: input.vahOk,
    twoBarEval: twoBar,
    twoBarInlinePassed: twoBar.ok,
    longBreakout1h: false,
    breakout1hEval: null,
    trendMomentum,
    momentumRequired: snowballGradeBRequiresSustainedMomentum(),
    momentumOk: failCount === 0,
    gradeDPlusOnMomentumFail: snowballGradeBMomentumFailGradeDOn1hConfirmPass(),
    gradeFOnMomentumAndConfirmFail: snowballGradeFOnMomentumAnd1hConfirmFail(),
    volumeStrictOk: volStrictOk,
    volumeNearMissOnly: input.volNearMissOnly,
    gradeDPlusNearMissVolumeEnabled: snowballGradeBNearMissVolumeEnabled(),
  });

  const structureTier =
    gradeRes.kind === "grade"
      ? gradeRes.structureTier
      : classifyLongStructureTier(swing48, input.swing200, vahOk);

  let stage3Head: string;
  if (!stage2Pass) {
    stage3Head = "— (ไม่ถึง — Stage 2 ไม่ผ่าน)";
  } else if (failCount === 0) {
    stage3Head = `PASS (Status: ${stage1Ceiling}+ · Full)`;
  } else if (failCount === 1) {
    stage3Head = `FAIL 1 ITEM (Status: ${matrixResult.displayGrade} · ${snowballActionPlanLabel(matrixResult.actionPlan)})`;
  } else if (failCount === 2) {
    stage3Head = `FAIL 2 ITEMS (Status: ${matrixResult.displayGrade} · ${snowballActionPlanLabel(matrixResult.actionPlan)})`;
  } else {
    stage3Head = "FAIL 3 ITEMS (Status: D · Monitor — no auto-open)";
  }

  const ddMax = snowballTrendMomentumMaxDrawbackPct();
  const maxVolDrops = snowballTrendMomentumMaxVolumeDrops();
  const ddPct = trendMomentum?.maxDrawbackPercent ?? null;
  const volDrops = trendMomentum?.volumeDropCount ?? null;

  const lines: string[] = [
    "==================================================",
    `❄️ SNOWBALL 4H DEBUG CHECKLIST : ${pairSlash(symbol)}`,
    "==================================================",
    "",
    `🟢 [STAGE 1: 4H STRUCTURE] -> ${stage1Pass ? "PASS" : "FAIL"} (Status: ${stage1Pass ? "Active" : "Blocked"})`,
    `  [${stageMark(swing48)}] Swing HH${swingLb} Check (Close > Reference ${priorMaxHigh != null ? fmtPx(priorMaxHigh) : "—"})`,
    `  [${stageMark(swing200)}] Swing HH${swingGradeLb} Check (Close > Reference ${priorMaxHighGrade != null && Number.isFinite(priorMaxHighGrade) ? fmtPx(priorMaxHighGrade) : "—"}) — โครงสร้างใหญ่ จัดเกรด`,
    longVahOn
      ? `  [${stageMark(vahOk)}] VAH Proxy Escape (Price > Vol Peak ${vahHigh != null ? fmtPx(vahHigh) : "—"})`
      : `  [—] VAH Proxy Escape (ปิด — INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK)`,
    !longSlopeEmaOn && !longEma2On
      ? `  [—] EMA Trend Check  (ปิด)`
      : `  [${stageMark(emaTrendOk)}] EMA Trend Check  (EMA${longSlopeEmaOn ? longSlopeEmaP : "—"}/${longEma2On ? longEma2P : "—"} Slope Up & Aligned)`,
  ];
  if (longRequireInnerHvnClear) {
    lines.push(
      `  [${stageMark(innerOk)}] Inner HVN Clear (Price > HVN High ${innerHvnHigh != null ? fmtPx(innerHvnHigh) : "—"})`,
    );
  }
  lines.push(
    "",
    `🔵 [STAGE 2: TWO-BAR INLINE 4H] -> ${stage2Pass ? "PASS" : "FAIL"} (Status: ${stage2Pass ? "Secure" : "BLOCK — ไม่ส่ง TG"})`,
    `  [${stageMark(twoBar.pullbackOk)}] Pullback Check  : ${pullbackPct.toFixed(1)}% (Limit <= ${(frac * 100).toFixed(0)}%)`,
    `  [${stageMark(twoBar.volRatioOk)}] Vol Ratio Check : ${Number.isFinite(volRatio) ? fmtNum(volRatio, 2) : "—"}  (Limit >= ${vr})`,
    `  [${stageMark(twoBar.minLow1hOk)}] Min-Low 1H Check: Min ${minL != null ? fmtPx(minL) : "—"} >= Signal Low ${fmtPx(sigL)}`,
    "",
    `🟡 [STAGE 3: MOMENTUM & VOL 1H] -> ${stage3Head}`,
    `  [${stageMark(ddOk)}] Max DD 15m (${SNOWBALL_TREND_15M_DD_LOOKBACK} Bars) : ${ddPct != null ? ddPct.toFixed(2) : "—"}% (Limit <= ${ddMax}%)${!ddOk ? " -> [FAILED]" : ""}`,
    `  [${stageMark(volCascadeOk)}] Vol Cascade ${SNOWBALL_TREND_1H_VOL_LOOKBACK}B  : ${volDrops != null ? volDrops : "—"} Times Drop  (Limit <= ${maxVolDrops} Time)${!volCascadeOk ? " -> [FAILED]" : ""}`,
    `  [${stageMark(volStrictOk)}] Signal Vol Spurt: ${signalVolVsSma != null ? `${signalVolVsSma.toFixed(2)}x` : "—"} SMA      (Limit > ${volMult}x)${!volStrictOk ? " -> [FAILED]" : ""}`,
    "",
    "--------------------------------------------------",
    "🎯 FINAL GRADE DETERMINATION:",
    `- Stage 1 (Ceiling)   : ${stage1Ceiling}  (${stage1Pass ? "PASS" : "FAIL"})`,
    `- Stage 2 (Gatekeeper): ${stage2Pass ? "PASS" : "FAIL (BLOCK)"}`,
    `- Stage 3 (Adjuster)  : ${!stage2Pass ? "—" : `พลาด ${failCount}/3 · notch ${matrixResult.notch >= 0 ? "+" : ""}${matrixResult.notch}`}`,
    `- Decision Matrix     : ${stage1Ceiling} × พลาด ${failCount} → ${matrixResult.displayGrade}`,
    `- Action Plan         : ${snowballActionPlanLabel(matrixResult.actionPlan)}`,
    `- Result              : [ ${finalGradeLine(gradeRes)} ]`,
    `  โครงสร้าง: ${snowballLongGradeShortLabel(structureTier)} · two-bar: ${twoBar.detail}`,
    "==================================================",
  );

  return lines.join("\n");
}
