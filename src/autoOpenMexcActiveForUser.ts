import {
  annotateAutoOpenRowsWithMexcActive,
  botAutoTradeActiveKeys,
  mergeMexcActiveKeys,
  mexcOpenPositionActiveKeys,
} from "@/lib/autoOpenMexcActive";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { fetchAllOpenPositions, type MexcCredentials } from "./mexcFuturesClient";
import { loadReversalAutoTradeState } from "./reversalAutoTradeStateStore";
import { loadSnowballAutoTradeState } from "./snowballAutoTradeStateStore";
import { ensureTradingViewMexcUserRow } from "./tradingViewCloseSettingsStore";

export async function resolveAutoOpenMexcActiveKeysForUser(userId: string): Promise<Set<string>> {
  const uid = userId.trim();
  if (!uid) return new Set();

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
    return botKeys;
  }

  const creds: MexcCredentials = { apiKey, secret };
  try {
    const res = await fetchAllOpenPositions(creds);
    if (!res.ok) return botKeys;
    return mergeMexcActiveKeys(mexcOpenPositionActiveKeys(res.rows), botKeys);
  } catch (e) {
    console.error("[autoOpenMexcActive] fetch open positions", uid, e);
    return botKeys;
  }
}

export async function attachAutoOpenMexcActiveFlags(
  userId: string,
  rows: AutoOpenOrderLogRow[],
): Promise<AutoOpenOrderLogRow[]> {
  const activeKeys = await resolveAutoOpenMexcActiveKeysForUser(userId);
  return annotateAutoOpenRowsWithMexcActive(rows, activeKeys);
}
