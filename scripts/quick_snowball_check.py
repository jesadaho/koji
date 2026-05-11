import json
import math
import sys


def sma(arr, p):
    out = [math.nan] * len(arr)
    s = 0.0
    for k, v in enumerate(arr):
        s += v
        if k >= p:
            s -= arr[k - p]
        if k >= p - 1:
            out[k] = s / p
    return out


def ema(arr, p):
    out = [math.nan] * len(arr)
    a = 2.0 / (p + 1.0)
    prev = arr[0]
    out[0] = prev
    for k in range(1, len(arr)):
        prev = a * arr[k] + (1.0 - a) * prev
        out[k] = prev
    return out


def rsi_wilder(close, p):
    out = [math.nan] * len(close)
    gain = 0.0
    loss = 0.0
    for k in range(1, p + 1):
        d = close[k] - close[k - 1]
        gain += max(0.0, d)
        loss += max(0.0, -d)
    gain /= p
    loss /= p
    out[p] = 100.0 if loss == 0 else 100.0 - 100.0 / (1.0 + gain / loss)
    for k in range(p + 1, len(close)):
        d = close[k] - close[k - 1]
        g = max(0.0, d)
        l = max(0.0, -d)
        gain = (gain * (p - 1) + g) / p
        loss = (loss * (p - 1) + l) / p
        out[k] = 100.0 if loss == 0 else 100.0 - 100.0 / (1.0 + gain / loss)
    return out


def stoch_rsi_k(close, rsi_p=14, st_len=14):
    rsi = rsi_wilder(close, rsi_p)
    k = [math.nan] * len(close)
    for idx in range(len(close)):
        if idx < rsi_p + st_len:
            continue
        lo = math.inf
        hi = -math.inf
        for j in range(idx - st_len + 1, idx + 1):
            lo = min(lo, rsi[j])
            hi = max(hi, rsi[j])
        v = rsi[idx]
        k[idx] = ((v - lo) / (hi - lo) * 100.0) if hi > lo else 0.0
    return k


def max_prior(arr, idx, lb, exclude_recent=2):
    """สอดคล้องบอท: high สูงสุดใน [idx-lb, idx-1-exclude_recent]"""
    end = idx - 1 - exclude_recent
    start = max(0, idx - lb)
    if end < start:
        return -math.inf
    m = -math.inf
    for j in range(start, end + 1):
        m = max(m, arr[j])
    return m


def hvn_bar_range(vol, high, low, idx, lb):
    start = max(0, idx - lb)
    best_j = start
    best_v = -math.inf
    for j in range(start, idx):
        v = vol[j]
        if math.isfinite(v) and v > best_v:
            best_v = v
            best_j = j
    return {"high": high[best_j], "low": low[best_j], "j": best_j, "v": best_v}


def slope2(e, idx):
    return (
        idx >= 2
        and math.isfinite(e[idx])
        and math.isfinite(e[idx - 1])
        and math.isfinite(e[idx - 2])
        and e[idx] > e[idx - 1]
        and e[idx - 1] > e[idx - 2]
    )


def main():
    sym = sys.argv[1] if len(sys.argv) > 1 else "SAGAUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "4h"
    input_path = sys.argv[3] if len(sys.argv) > 3 else "saga_klines.json"
    with open(input_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    H = [float(r[2]) for r in raw]
    L = [float(r[3]) for r in raw]
    C = [float(r[4]) for r in raw]
    V = [float(r[5]) for r in raw]

    lookback = 48
    swing_exclude = 2
    vol_sma_p = 20
    vol_mult = 2.5
    inner_lb = 24
    vol_sma = sma(V, vol_sma_p)
    e20 = ema(C, 20)
    e50 = ema(C, 50)
    stoch_k = stoch_rsi_k(C, 14, 14)
    def eval_idx(idx: int, mode: str):
        if idx < 2 or idx >= len(C):
            return {"mode": mode, "idx": idx, "error": "idx out of range"}

        vol_ratio = V[idx] / vol_sma[idx] if math.isfinite(vol_sma[idx]) and vol_sma[idx] != 0 else math.nan
        vol_ok = math.isfinite(vol_ratio) and vol_ratio > vol_mult

        hh_ref = max_prior(H, idx, lookback, swing_exclude)
        # bot: intrabar ใช้ high; close mode ใช้ close
        hh_ok = math.isfinite(hh_ref) and ((H[idx] > hh_ref) if mode == "intrabar" else (C[idx] > hh_ref))

        hvn = hvn_bar_range(V, H, L, idx, inner_lb)
        svp_clear_ok = math.isfinite(hvn["high"]) and ((H[idx] > hvn["high"]) if mode == "intrabar" else (C[idx] > hvn["high"]))

        ema20_ok = slope2(e20, idx)
        ema50_ok = slope2(e50, idx)

        snowball_long_ok = hh_ok and vol_ok and svp_clear_ok and ema20_ok and ema50_ok

        return {
            "mode": mode,
            "idx": idx,
            "close": C[idx],
            "high": H[idx],
            "hhRef": hh_ref,
            "swingExcludeRecent": swing_exclude,
            "hhOk": hh_ok,
            "vol": V[idx],
            "volSma": vol_sma[idx],
            "volRatio": vol_ratio,
            "volGate": vol_mult,
            "volOk": vol_ok,
            "hvnHigh": hvn["high"],
            "hvnLow": hvn["low"],
            "hvnIdx": hvn["j"],
            "hvnVol": hvn["v"],
            "svpClearOk": svp_clear_ok,
            "ema20": e20[idx],
            "ema50": e50[idx],
            "ema20Ok": ema20_ok,
            "ema50Ok": ema50_ok,
            "stochK": stoch_k[idx],
            "stochLongFilter": False,
            "snowballLongOk": snowball_long_ok,
        }

    last_closed = len(C) - 2
    forming = len(C) - 1

    print(
        json.dumps(
            {
                "symbol": sym,
                "interval": interval,
                "lastClosed": eval_idx(last_closed, "close"),
                "formingIntrabar": eval_idx(forming, "intrabar"),
                "note": "close=แท่งปิดล่าสุด; intrabar=แท่งกำลังก่อตัว; HH ไม่นับแท่งล่าสุด N แท่งก่อนสัญญาณ (default 2) — ตรงกับ INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

