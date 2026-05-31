import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authenticateTmaFromRequest,
  authenticateTmaRequest,
  tgUserIdToStoreKey,
  type TmaAuthResult,
} from "@/src/telegramMiniAppAuth";
import {
  createTmaCsvExportToken,
  verifyTmaCsvExportToken,
  TMA_CSV_EXPORT_PATHS,
} from "@/src/tmaCsvExportToken";
import { consumeTmaStagedCsv, putTmaStagedCsv } from "@/src/tmaCsvStagingStore";
import { candleReversalStatsToCsv } from "@/lib/candleReversalStatsCsvExport";
import {
  filterCandleReversalStatsRows,
  reversalStatsFilterQueryFromSearchParams,
  type ReversalStatsFilterQuery,
} from "@/lib/candleReversalStatsFilters";
import { rsiDivergenceStatsToCsv } from "@/lib/rsiDivergenceStatsCsvExport";
import { snowballStatsToCsv } from "@/lib/snowballStatsCsvExport";
import { statsCsvAttachmentResponse, statsCsvFilename } from "@/lib/statsCsvResponse";
import { getTmaConfig, getTmaMeta } from "@/src/miniAppService";
import {
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
  liffGetSparkStats,
  liffGetSnowballStats,
  liffDeleteSnowballStatsRow,
  liffResetSnowballStats,
  liffCorrectSnowballStatsOutcome,
  liffBackfillCandleReversalStats,
  liffBackfillRsiDivergenceStats,
  liffGetCandleReversalStats,
  liffResetCandleReversalStats,
  liffGetRsiDivergenceStats,
  liffResetRsiDivergenceStats,
  liffGetTradingViewMexcSettings,
  liffSetTradingViewMexcSettings,
  liffGetAutoOpenOrderHistory,
  liffGetAutoOpenMarkPrices,
  liffClearSkippedAutoOpenOrderLogs,
} from "@/src/liffService";
import { autoOpenOrderLogToCsv } from "@/lib/autoOpenOrderLogCsvExport";
import type { AutoOpenSource } from "@/lib/autoOpenOrderLogClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { path: string[] } };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function jsonError(e: unknown, status = 500) {
  console.error("[api/tma]", e);
  const msg = e instanceof Error ? e.message : "Internal Server Error";
  return json({ error: msg }, status);
}

type TmaCsvDownloadAuth =
  | { ok: false; status: number; error: string }
  | { ok: true; userId: string; telegramUserId: number; stagingId?: string };

/** Authorization header หรือ ?csv_token= (สำหรับ Telegram.WebApp.downloadFile) */
async function authenticateTmaCsvDownload(
  req: NextRequest,
  csvPath: string,
): Promise<TmaCsvDownloadAuth> {
  const token = req.nextUrl.searchParams.get("csv_token");
  if (token) {
    const claims = verifyTmaCsvExportToken(token, csvPath);
    if (claims == null) {
      return { ok: false, status: 401, error: "ลิงก์ดาวน์โหลดหมดอายุหรือไม่ถูกต้อง" };
    }
    return {
      ok: true,
      userId: tgUserIdToStoreKey(claims.telegramUserId),
      telegramUserId: claims.telegramUserId,
      stagingId: claims.stagingId,
    };
  }
  const base = await authenticateTmaFromRequest(
    req.headers.get("authorization"),
    req.nextUrl.searchParams.get("tma"),
  );
  if (!base.ok) return base;
  return {
    ok: true,
    userId: base.userId,
    telegramUserId: base.telegramUserId,
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const segs = ctx.params.path ?? [];
    const [a] = segs;

    if (segs.length === 1 && a === "config") {
      return json(getTmaConfig());
    }
    if (segs.length === 1 && a === "meta") {
      return json(getTmaMeta());
    }
    if (segs.length === 1 && a === "alerts") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "contract-watches") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListContractWatches(auth.userId));
    }
    if (segs.length === 1 && a === "pct-alerts") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListPctAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "price") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
      const r = await liffPrice(symbol);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "system-change-subscription") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffGetSystemChangeSubscription(auth.userId));
    }
    if (segs.length === 1 && a === "volume-signal-meta") {
      return json(await liffGetVolumeSignalMeta());
    }
    if (segs.length === 1 && a === "volume-signal-alerts") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListVolumeSignalAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "indicator-meta") {
      return json(await liffGetIndicatorMeta());
    }
    if (segs.length === 1 && a === "indicator-alerts") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return json(await liffListIndicatorAlerts(auth.userId));
    }
    if (segs.length === 1 && a === "spark-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetSparkStats();
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 1 && a === "snowball-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetSnowballStats(auth.telegramUserId);
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 1 && a === "stats-export.csv") {
      const auth = await authenticateTmaCsvDownload(req, "stats-export.csv");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const stagingId = auth.stagingId?.trim();
      if (!stagingId) return json({ error: "missing_staging" }, 400);
      const staged = consumeTmaStagedCsv(auth.telegramUserId, stagingId);
      if (!staged) {
        return json({ error: "ไฟล์หมดอายุหรือดาวน์โหลดไปแล้ว — กด Export อีกครั้ง" }, 404);
      }
      return statsCsvAttachmentResponse(staged.csv, staged.filename);
    }
    if (segs.length === 1 && a === "snowball-stats.csv") {
      const auth = await authenticateTmaCsvDownload(req, "snowball-stats.csv");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetSnowballStats(auth.telegramUserId);
      const csv = snowballStatsToCsv(data.rows);
      return statsCsvAttachmentResponse(csv, statsCsvFilename("snowball-stats"));
    }
    if (segs.length === 1 && a === "reversal-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetCandleReversalStats(auth.telegramUserId);
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 1 && a === "reversal-stats.csv") {
      const auth = await authenticateTmaCsvDownload(req, "reversal-stats.csv");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetCandleReversalStats(auth.telegramUserId);
      const fq = reversalStatsFilterQueryFromSearchParams(req.nextUrl.searchParams);
      const rows = filterCandleReversalStatsRows(data.rows, fq);
      const csv = candleReversalStatsToCsv(rows);
      const filenameParts = ["reversal-stats"];
      if (fq.tf) filenameParts.push(fq.tf);
      if (fq.side) filenameParts.push(fq.side);
      if (fq.matrix && fq.matrix !== "all") filenameParts.push(fq.matrix);
      const filenamePrefix = filenameParts.join("-");
      return statsCsvAttachmentResponse(csv, statsCsvFilename(filenamePrefix));
    }
    if (segs.length === 1 && a === "auto-open-history") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const daysRaw = req.nextUrl.searchParams.get("days");
      const days = daysRaw != null ? Number(daysRaw) : undefined;
      const srcRaw = req.nextUrl.searchParams.get("source")?.toLowerCase();
      const source: AutoOpenSource | undefined =
        srcRaw === "snowball" || srcRaw === "reversal" ? srcRaw : undefined;
      const data = await liffGetAutoOpenOrderHistory(auth.userId, {
        days: Number.isFinite(days) && days! > 0 ? days : undefined,
        source,
      });
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 2 && a === "auto-open-history" && segs[1] === "mark-prices") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const raw = req.nextUrl.searchParams.get("symbols")?.trim() ?? "";
      const symbols = raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const data = await liffGetAutoOpenMarkPrices(symbols);
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 1 && a === "auto-open-history.csv") {
      const auth = await authenticateTmaCsvDownload(req, "auto-open-history.csv");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const daysRaw = req.nextUrl.searchParams.get("days");
      const days = daysRaw != null ? Number(daysRaw) : undefined;
      const srcRaw = req.nextUrl.searchParams.get("source")?.toLowerCase();
      const source: AutoOpenSource | undefined =
        srcRaw === "snowball" || srcRaw === "reversal" ? srcRaw : undefined;
      const data = await liffGetAutoOpenOrderHistory(auth.userId, {
        days: Number.isFinite(days) && days! > 0 ? days : undefined,
        source,
      });
      const csv = autoOpenOrderLogToCsv(data.rows);
      return statsCsvAttachmentResponse(csv, statsCsvFilename("auto-open-history"));
    }
    if (segs.length === 1 && a === "divergence-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetRsiDivergenceStats(auth.telegramUserId);
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (segs.length === 1 && a === "divergence-stats.csv") {
      const auth = await authenticateTmaCsvDownload(req, "divergence-stats.csv");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const data = await liffGetRsiDivergenceStats(auth.telegramUserId);
      const kindRaw = req.nextUrl.searchParams.get("kind")?.toLowerCase();
      const kindFilter = kindRaw === "bullish" || kindRaw === "bearish" ? kindRaw : null;
      const rows = kindFilter ? data.rows.filter((r) => r.kind === kindFilter) : data.rows;
      const csv = rsiDivergenceStatsToCsv(rows);
      const filenamePrefix = kindFilter ? `divergence-stats-${kindFilter}` : "divergence-stats";
      return statsCsvAttachmentResponse(csv, statsCsvFilename(filenamePrefix));
    }
    if (segs.length === 1 && a === "trading-view-mexc") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffGetTradingViewMexcSettings(auth.userId);
      return json(r.json, r.status);
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

    if (segs.length === 1 && a === "csv-export-token") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: { path?: string };
      try {
        body = (await req.json()) as { path?: string };
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const path = typeof body.path === "string" ? body.path.trim() : "";
      if (!path || !TMA_CSV_EXPORT_PATHS.has(path) || path === "stats-export.csv") {
        return json({ error: "path ไม่รองรับ" }, 400);
      }
      const token = createTmaCsvExportToken(auth.telegramUserId, path);
      if (!token) {
        return json({ error: "สร้างลิงก์ดาวน์โหลดไม่ได้" }, 500);
      }
      return json({ token, path, expiresSec: 120 });
    }

    if (segs.length === 1 && a === "csv-export-staging") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: {
        csv?: string;
        filename?: string;
        source?: string;
        filters?: ReversalStatsFilterQuery;
      };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const filename =
        typeof body.filename === "string" && body.filename.trim()
          ? body.filename.trim()
          : "export.csv";

      let csvText = typeof body.csv === "string" ? body.csv : "";
      if (body.source === "reversal-stats") {
        const data = await liffGetCandleReversalStats(auth.telegramUserId);
        const fq = body.filters ?? {};
        const rows = filterCandleReversalStatsRows(data.rows, fq);
        csvText = candleReversalStatsToCsv(rows);
      }

      const put = putTmaStagedCsv(auth.telegramUserId, csvText, filename);
      if ("error" in put) {
        const msg =
          put.error === "csv_too_large"
            ? "ไฟล์ใหญ่เกินไป — ลดตัวกรองหรือย่อช่วงเวลา"
            : put.error === "empty_csv"
              ? "ไม่มีข้อมูลให้ export"
              : "บันทึกชั่วคราวไม่สำเร็จ";
        return json({ error: msg }, put.error === "csv_too_large" ? 413 : 400);
      }
      const token = createTmaCsvExportToken(
        auth.telegramUserId,
        "stats-export.csv",
        put.stagingId,
      );
      if (!token) {
        return json({ error: "สร้างลิงก์ดาวน์โหลดไม่ได้" }, 500);
      }
      return json({ token, path: "stats-export.csv", expiresSec: 120 });
    }

    if (segs.length === 1 && a === "alerts") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
    if (segs.length === 1 && a === "trading-view-mexc") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON ไม่ถูกต้อง" }, 400);
      }
      const r = await liffSetTradingViewMexcSettings(auth.userId, body);
      return json(r.json, r.status);
    }
    if (segs.length === 1 && a === "reversal-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffResetCandleReversalStats(auth.telegramUserId);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({ ok: true });
    }
    if (segs.length === 2 && a === "reversal-stats" && segs[1] === "backfill") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffBackfillCandleReversalStats(auth.telegramUserId);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({
        ok: true,
        updated: r.updated,
        scanned: r.scanned,
        changedOutcome: r.changedOutcome,
      });
    }
    if (segs.length === 1 && a === "divergence-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffResetRsiDivergenceStats(auth.telegramUserId);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({ ok: true });
    }
    if (segs.length === 2 && a === "divergence-stats" && segs[1] === "backfill") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffBackfillRsiDivergenceStats(auth.telegramUserId);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({
        ok: true,
        updated: r.updated,
        scanned: r.scanned,
        changedOutcome: r.changedOutcome,
      });
    }
    if (segs.length === 2 && a === "auto-open-history" && segs[1] === "clear-skipped") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let source: AutoOpenSource | undefined;
      try {
        const body = (await req.json()) as { source?: unknown } | null;
        const srcRaw =
          body && typeof body === "object" && typeof body.source === "string"
            ? body.source.trim().toLowerCase()
            : "";
        if (srcRaw === "snowball" || srcRaw === "reversal") source = srcRaw;
      } catch {
        /* no body = ลบ skipped ทุกแหล่งของ user */
      }
      const r = await liffClearSkippedAutoOpenOrderLogs(auth.userId, { source });
      return json(r);
    }
    if (segs.length === 1 && a === "snowball-stats") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffResetSnowballStats(auth.telegramUserId);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({ ok: true });
    }
    if (segs.length === 2 && a === "snowball-stats" && segs[1] === "correct") {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let symbol: string | undefined;
      try {
        const body = (await req.json()) as { symbol?: unknown } | null;
        if (body && typeof body === "object" && typeof body.symbol === "string" && body.symbol.trim()) {
          symbol = body.symbol.trim();
        }
      } catch {
        /* no body or invalid JSON = correct ทั้งตาราง */
      }
      const r = await liffCorrectSnowballStatsOutcome(auth.telegramUserId, { symbol });
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({
        ok: true,
        scanned: r.scanned,
        changedOutcome: r.changedOutcome,
        changedRr: r.changedRr,
      });
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
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
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "contract-watches" && id) {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteContractWatch(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "pct-alerts" && id) {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeletePctAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "volume-signal-alerts" && id) {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteVolumeSignalAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "indicator-alerts" && id) {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteIndicatorAlert(auth.userId, decodeURIComponent(id));
      if (r.status === 204) {
        return new NextResponse(null, { status: 204 });
      }
      return json(r.json ?? {}, r.status);
    }
    if (segs.length === 2 && a === "snowball-stats" && id) {
      const auth = await authenticateTmaRequest(req.headers.get("authorization"));
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      const r = await liffDeleteSnowballStatsRow(auth.telegramUserId, decodeURIComponent(id));
      if (!r.ok) return json({ error: r.error }, r.status);
      return new NextResponse(null, { status: 204 });
    }

    return json({ error: "ไม่พบเส้นทาง" }, 404);
  } catch (e) {
    return jsonError(e);
  }
}
