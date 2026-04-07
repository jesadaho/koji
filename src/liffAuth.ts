import axios from "axios";

/**
 * ยืนยัน ID Token ผ่าน LINE `POST /oauth2/v2.1/verify` (ฝั่ง LINE ตรวจ exp/iat)
 * ไม่ได้ decode JWT ในเครื่อง — ไม่เกี่ยวกับ clockTolerance ของ jsonwebtoken บนเซิร์ฟเวอร์เรา
 */

type VerifyOk = {
  sub?: string;
  aud?: string;
};

type VerifyErr = {
  error?: string;
  error_description?: string;
};

export async function verifyLiffIdToken(
  idToken: string,
  channelId: string
): Promise<{ userId: string }> {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });
  const { status, data } = await axios.post<VerifyOk & VerifyErr>(
    "https://api.line.me/oauth2/v2.1/verify",
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10_000,
      validateStatus: () => true,
    }
  );

  if (status === 200 && data.sub) {
    return { userId: data.sub };
  }

  const err = data as VerifyErr;
  const fromLine = err.error_description?.trim() || err.error?.trim();
  if (fromLine) {
    throw new Error(fromLine);
  }
  throw new Error(status !== 200 ? `LINE verify HTTP ${status}` : "invalid_id_token");
}
