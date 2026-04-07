import axios from "axios";

type VerifyResponse = {
  sub?: string;
  aud?: string;
};

export async function verifyLiffIdToken(
  idToken: string,
  channelId: string
): Promise<{ userId: string }> {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });
  const { status, data } = await axios.post<VerifyResponse>(
    "https://api.line.me/oauth2/v2.1/verify",
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10_000,
      validateStatus: () => true,
    }
  );
  if (status !== 200 || !data.sub) {
    throw new Error("invalid_id_token");
  }
  return { userId: data.sub };
}
