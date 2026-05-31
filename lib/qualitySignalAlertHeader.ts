/** ป้ายใน header แจ้งเตือน Telegram เมื่อสัญญาณผ่านเกณฑ์ Quality Signal */
export const QUALITY_SIGNAL_ALERT_HEADER_TAG = "✨ Quality Signal";

export function qualitySignalAlertHeaderSuffix(isQuality: boolean): string {
  return isQuality ? ` · ${QUALITY_SIGNAL_ALERT_HEADER_TAG}` : "";
}

export function withQualitySignalAlertHeader(headline: string, isQuality: boolean): string {
  return `${headline}${qualitySignalAlertHeaderSuffix(isQuality)}`;
}
