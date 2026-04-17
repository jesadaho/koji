import { validateSignature } from "@line/bot-sdk";
import type { WebhookEvent } from "@line/bot-sdk";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { createLineClient, handleWebhookEvent } from "@/src/lineHandler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const channelSecret = config.lineChannelSecret;
  const accessToken = config.lineChannelAccessToken;
  if (!channelSecret || !accessToken) {
    return NextResponse.json(
      { error: "LINE OA ปิด — ไม่ได้ตั้ง LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN" },
      { status: 503 }
    );
  }

  const signature = req.headers.get("x-line-signature");
  if (!signature) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await req.text();
  if (!validateSignature(body, channelSecret, signature)) {
    return new NextResponse(null, { status: 401 });
  }

  let payload: { events?: WebhookEvent[] };
  try {
    payload = JSON.parse(body) as { events?: WebhookEvent[] };
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const client = createLineClient(accessToken);
  const events = payload.events ?? [];

  try {
    await Promise.all(events.map((ev) => handleWebhookEvent(client, ev)));
    return new NextResponse(null, { status: 200 });
  } catch (e) {
    console.error(e);
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET() {
  return new NextResponse("LINE webhook: ใช้ POST", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
