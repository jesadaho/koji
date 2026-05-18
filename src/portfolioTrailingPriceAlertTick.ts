import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { fetchSimplePrices } from "./cryptoService";
import {
  fetchAllOpenPositions,
  fetchContractDetailPublic,
  type MexcCredentials,
} from "./mexcFuturesClient";
import {
  buildPortfolioTrailingAlertMessage,
  computePositionUnrealizedFromMark,
  contractSymbolToPairLabel,
  evaluateTrailingPriceStep,
} from "./pctTrailingAlertUtils";
import {
  loadPortfolioTrailingAnchors,
  pruneUserPortfolioTrailingSymbols,
  upsertPortfolioTrailingAnchors,
} from "./portfolioTrailingAlertStateStore";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";

const TG_USER_RE = /^tg:\d+$/;

function isActivePosition(p: { state: number; holdVol: number }): boolean {
  return p.state === 1 && Number(p.holdVol) > 0;
}

async function loadContractSizeBySymbol(
  symbols: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    symbols.map(async (sym) => {
      const detail = await fetchContractDetailPublic(sym);
      const cs = detail?.contractSize != null ? Number(detail.contractSize) : NaN;
      if (Number.isFinite(cs) && cs > 0) out.set(sym, cs);
    })
  );
  return out;
}

/** แจ้งเตือน trailing % ของเหรียญใน open MEXC positions — cron ~5 นาที */
export async function runPortfolioTrailingPriceAlertTick(
  client: Client
): Promise<{ notified: number; usersScanned: number }> {
  const map = await loadTradingViewMexcSettingsFullMap();
  const allAnchors = await loadPortfolioTrailingAnchors();
  const anchorByUserSymbol = new Map<string, number | undefined>();
  for (const a of allAnchors) {
    anchorByUserSymbol.set(`${a.userId}\0${a.coinId}`, a.trailingAnchorPrice);
  }

  let notified = 0;
  let usersScanned = 0;

  for (const [userId, row] of Object.entries(map)) {
    if (!TG_USER_RE.test(userId.trim())) continue;
    if (!row.portfolioTrailingAlertEnabled) continue;
    const stepPct = row.portfolioTrailingStepPct;
    if (!stepPct || !Number.isFinite(stepPct) || stepPct <= 0) continue;

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) continue;

    usersScanned += 1;

    let posRes: Awaited<ReturnType<typeof fetchAllOpenPositions>>;
    try {
      posRes = await fetchAllOpenPositions(creds);
    } catch (e) {
      console.error("[portfolioTrailingPriceAlertTick] open_positions", userId, e);
      continue;
    }
    if (!posRes.ok) {
      console.error("[portfolioTrailingPriceAlertTick] open_positions fail", userId, posRes.message);
      continue;
    }

    const actives = posRes.rows.filter(isActivePosition);
    const coinIds = Array.from(new Set(actives.map((p) => p.symbol).filter(Boolean)));
    await pruneUserPortfolioTrailingSymbols(userId, coinIds);

    if (coinIds.length === 0) continue;

    const [prices, contractSizeBySymbol] = await Promise.all([
      fetchSimplePrices(coinIds),
      loadContractSizeBySymbol(coinIds),
    ]);
    const anchorUpdates: Array<{ userId: string; coinId: string; trailingAnchorPrice: number }> =
      [];

    for (const pos of actives) {
      const coinId = pos.symbol;
      if (!coinId) continue;
      const q = prices[coinId];
      if (!q) continue;
      const p = q.usd;
      if (!Number.isFinite(p) || p <= 0) continue;

      const prevAnchor = anchorByUserSymbol.get(`${userId}\0${coinId}`);
      const step = evaluateTrailingPriceStep(p, prevAnchor, stepPct);
      anchorByUserSymbol.set(`${userId}\0${coinId}`, step.nextAnchor);
      const pairLabel = contractSymbolToPairLabel(coinId);
      const side: "LONG" | "SHORT" = pos.positionType === 1 ? "LONG" : "SHORT";
      const pnl = computePositionUnrealizedFromMark(
        pos,
        p,
        contractSizeBySymbol.get(coinId)
      );

      if (step.fired) {
        try {
          await sendAlertNotification(
            client,
            userId,
            buildPortfolioTrailingAlertMessage(step.prevAnchor, step.price, {
              pairLabel,
              side,
              entryPrice: pnl.entryPrice,
              unrealizedUsdt: pnl.unrealizedUsdt,
              pnlPct: pnl.pnlPct,
            })
          );
          notified += 1;
        } catch (e) {
          console.error("[portfolioTrailingPriceAlertTick] push", userId, coinId, e);
        }
      }

      anchorUpdates.push({
        userId,
        coinId,
        trailingAnchorPrice: step.nextAnchor,
      });
    }

    if (anchorUpdates.length > 0) {
      await upsertPortfolioTrailingAnchors(anchorUpdates);
    }
  }

  return { notified, usersScanned };
}
