import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function backendBase(): string {
  return (process.env.KOJI_API_URL ?? "").replace(/\/$/, "");
}

async function proxy(req: NextRequest, segments: string[]) {
  const base = backendBase();
  if (!base) {
    return NextResponse.json(
      {
        error:
          "Next ยังไม่มี KOJI_API_URL — ตั้งใน Vercel/เซิร์ฟเวอร์ หรือใช้ NEXT_PUBLIC_API_BASE_URL แบบตรงไป API",
      },
      { status: 503 }
    );
  }

  const sub = segments.length ? segments.join("/") : "";
  const url = new URL(req.url);
  const target = `${base}/api/liff/${sub}${url.search}`;

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  headers.set("accept", "application/json");
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) {
      init.body = buf;
    }
  }

  const res = await fetch(target, init);
  const outHeaders = new Headers();
  const outCt = res.headers.get("content-type");
  if (outCt) outHeaders.set("content-type", outCt);
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: outHeaders });
}

type Ctx = { params: { path: string[] } };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path ?? []);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path ?? []);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params.path ?? []);
}
