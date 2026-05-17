/** ค่า step % ที่เลือกได้ใน UI (เตือน% / portfolio trailing) */
export const PCT_STEP_PRESET_VALUES = [1, 2, 3, 5, 10] as const;

export type PctStepPresetValue = (typeof PCT_STEP_PRESET_VALUES)[number];

export function isPctStepPresetValue(n: number): n is PctStepPresetValue {
  return (PCT_STEP_PRESET_VALUES as readonly number[]).includes(n);
}
