import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authenticateLiffRequest,
  getLiffConfig,
  getLiffMeta,
  liffCreateAlert,
  liffCreateContractWatch,
  liffDeleteAlert,
  liffDeleteContractWatch,
  liffListAlerts,
  liffListContractWatches,
  liffListPctAlerts,
  liffCreatePctAlert,
  liffDeletePctAlert,
  liffGetSystemChangeSubscription,
  liffPrice,
  liffSetSystemChangeSubscription,
  liffListVolumeSignalAlerts,
  liffGetVolumeSignalMeta,
  liffCreateVolumeSignalAlert,
  liffSyncVolumeSignalAlerts,
  liffDeleteVolumeSignalAlert,
  liffGetIndicatorMeta,
  liffListIndicatorAlerts,
  liffSyncIndicatorAlerts,
  liffDeleteIndicatorAlert,
} from "@/src/liffService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { path: string[] } };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function jsonError(e: unknown, status = 500) {
  console.error("[api/liff]", e);
  const msg = e instanceof Error ? e.message : "Internal Server Error";
  return json({ error: msg }, status);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const segs = ctx.params.path ?? [];
    const [a] = segs;

    if (segs.length === 1 && a === "config") {
      return json(getLiffConfig());
    }
    if (segs.length === 1 && a === "meta") {
      return json(getLiffMeta());
    }
    if (segs.length === 1 && a === "alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "contract-watches") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListContractWatches(auth.userId));
    }
    if (segs.length === 1 && a === "pct-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListPctAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "price") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
      const r = await liffPrice(symbol);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "system-change-subscription") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffGetSystemChangeSubscription(auth.userId));
    }
    if (segs.length === 1 && a === "volume-signal-meta") {
      return json(await liffGetVolumeSignalMeta());
    }
    if (segs.length === 1 && a === "volume-signal-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListVolumeSignalAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "indicator-meta") {
      return json(await liffGetIndicatorMeta());
    }
    if (segs.length === 1 && a === "indicator-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListIndicatorAlerts(auth.userId));
    }

    return json({ error: "ไม่พบเส้นทาง" }, 404);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const segs = ctx.params.path ?? [];
    const [a] = segs;

    if (segs.length === 1 && a === "alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffCreateAlert(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "contract-watches") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffCreateContractWatch(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "pct-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffCreatePctAlert(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 2 && segs[0] === "volume-signal-alerts" && segs[1] === "sync") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffSyncVolumeSignalAlerts(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "volume-signal-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffCreateVolumeSignalAlert(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "indicator-alerts") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffSyncIndicatorAlerts(auth.userId, body);
      return json(r.json, r.status);
    }

    return json({ error: "ไม่พบเส้นทาง" }, 404);
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const segs = ctx.params.path ?? [];
    const [a] = segs;

    if (segs.length === 1 && a === "system-change-subscription") {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffSetSystemChangeSubscription(auth.userId, body);
      return json(r.json, r.status);
    }

    return json({ error: "ไม่พบเส้นทาง" }, 404);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const segs = ctx.params.path ?? [];
    const [a, id] = segs;

    if (segs.length === 2 && a === "alerts" && id) {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "contract-watches" && id) {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteContractWatch(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "pct-alerts" && id) {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeletePctAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "volume-signal-alerts" && id) {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteVolumeSignalAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "indicator-alerts" && id) {
      const auth = await authenticateLiffRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteIndicatorAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }

    return json({ error: "ไม่พบเส้นทาง" }, 404);
  } catch (e) {
    return jsonError(e);
  }
}
