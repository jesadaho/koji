import {
  annotateAutoOpenRowsWithMexcActive,
  autoOpenMexcActiveKey,
  botAutoTradeActiveKeys,
  mergeMexcActiveKeys,
  mexcOpenPositionActiveKeys,
} from "@/lib/autoOpenMexcActive";
import { buildMexcOpenPnlSnapshot } from "@/lib/autoOpenMexcLivePnl";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import {
  fetchAllOpenPositions,
  fetchContractDetailPublic,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { loadReversalAutoTradeState } from "./reversalAutoTradeStateStore";
import { loadSnowballAutoTradeState } from "./snowballAutoTradeStateStore";
import { ensureTradingViewMexcUserRow } from "./tradingViewCloseSettingsStore";

export type AutoOpenMexcOpenContext = {
  activeKeys: Set<string>;
  openPositions: OpenPositionRow[];
};

export async function resolveAutoOpenMexcOpenContextForUser(
  userId: string,
): Promise<AutoOpenMexcOpenContext> {
  const uid = userId.trim();
  if (!uid) return { activeKeys: new Set(), openPositions: [] };

  const [snowballState, reversalState, settingsRow] = await Promise.all([
    loadSnowballAutoTradeState(),
    loadReversalAutoTradeState(),
    ensureTradingViewMexcUserRow(uid),
  ]);

  const botKeys = mergeMexcActiveKeys(
    botAutoTradeActiveKeys(snowballState[uid]?.active ?? []),
    botAutoTradeActiveKeys(reversalState[uid]?.active ?? []),
  );

  const apiKey = settingsRow.mexcApiKey?.trim();
  const secret = settingsRow.mexcSecret?.trim();
  if (!apiKey || !secret) {
    return { activeKeys: botKeys, openPositions: [] };
  }

  const creds: MexcCredentials = { apiKey, secret };
  try {
    const res = await fetchAllOpenPositions(creds);
    if (!res.ok) return { activeKeys: botKeys, openPositions: [] };
    const openPositions = res.rows;
    return {
      activeKeys: mergeMexcActiveKeys(mexcOpenPositionActiveKeys(openPositions), botKeys),
      openPositions,
    };
  } catch (e) {
    console.error("[autoOpenMexcActive] fetch open positions", uid, e);
    return { activeKeys: botKeys, openPositions: [] };
  }
}

export async function resolveAutoOpenMexcActiveKeysForUser(userId: string): Promise<Set<string>> {
  const ctx = await resolveAutoOpenMexcOpenContextForUser(userId);
  return ctx.activeKeys;
}

export async function attachAutoOpenMexcActiveFlags(
  userId: string,
  rows: AutoOpenOrderLogRow[],
): Promise<AutoOpenOrderLogRow[]> {
  const { activeKeys } = await resolveAutoOpenMexcOpenContextForUser(userId);
  return annotateAutoOpenRowsWithMexcActive(rows, activeKeys);
}

async function loadContractSizesForSymbols(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const detail = await fetchContractDetailPublic(sym);
        const cs = detail?.contractSize != null ? Number(detail.contractSize) : NaN;
        if (Number.isFinite(cs) && cs > 0) out.set(sym, cs);
      } catch {
        /* ignore */
      }
    }),
  );
  return out;
}

export async function attachAutoOpenMexcOpenPnlSnapshots(
  rows: AutoOpenOrderLogRow[],
  openPositions: OpenPositionRow[],
  markPrices: Record<string, number>,
): Promise<AutoOpenOrderLogRow[]> {
  const activeSymbols = [
    ...new Set(
      rows
        .filter((r) => r.mexcActive && (r.side === "long" || r.side === "short"))
        .map((r) => r.contractSymbol.trim().toUpperCase()),
    ),
  ];
  if (activeSymbols.length === 0) return rows;

  const contractSizes = await loadContractSizesForSymbols(activeSymbols);
  const positionByKey = new Map<string, OpenPositionRow>();
  for (const p of openPositions) {
    if (p.state !== 1 || !(Number(p.holdVol) > 0)) continue;
    const sym = p.symbol?.trim().toUpperCase();
    if (!sym) continue;
    const side = p.positionType === 1 ? "long" : p.positionType === 2 ? "short" : null;
    if (!side) continue;
    positionByKey.set(autoOpenMexcActiveKey(sym, side), p);
  }

  return rows.map((row) => {
    if (!row.mexcActive || (row.side !== "long" && row.side !== "short")) return row;
    const key = autoOpenMexcActiveKey(row.contractSymbol, row.side);
    const pos = positionByKey.get(key);
    if (!pos) return row;
    const sym = row.contractSymbol.trim().toUpperCase();
    const snap = buildMexcOpenPnlSnapshot(pos, contractSizes.get(sym) ?? null, markPrices[sym]);
    if (!snap) return row;
    return { ...row, mexcOpenPnlSnapshot: snap };
  });
}
