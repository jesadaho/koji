import fs from "node:fs";

const sym = process.argv[2] || "SAGAUSDT";
const inputPath = process.argv[3] || "saga_15m.json";
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const H = raw.map((r) => Number(r[2]));
const L = raw.map((r) => Number(r[3]));
const C = raw.map((r) => Number(r[4]));
const V = raw.map((r) => Number(r[5]));

const i = C.length - 2; // last closed candle
const lookback = 48;
const volSmaP = 20;
const volMult = 2.5;
const innerLb = 24;

function sma(arr, p) {
  const out = Array(arr.length).fill(Number.NaN);
  let s = 0;
  for (let k = 0; k < arr.length; k++) {
    s += arr[k];
    if (k >= p) s -= arr[k - p];
    if (k >= p - 1) out[k] = s / p;
  }
  return out;
}

function ema(arr, p) {
  const out = Array(arr.length).fill(Number.NaN);
  const a = 2 / (p + 1);
  let prev = arr[0];
  out[0] = prev;
  for (let k = 1; k < arr.length; k++) {
    prev = a * arr[k] + (1 - a) * prev;
    out[k] = prev;
  }
  return out;
}

function rsiWilder(close, p) {
  const out = Array(close.length).fill(Number.NaN);
  let gain = 0,
    loss = 0;
  for (let k = 1; k <= p; k++) {
    const d = close[k] - close[k - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  gain /= p;
  loss /= p;
  out[p] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let k = p + 1; k < close.length; k++) {
    const d = close[k] - close[k - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    gain = (gain * (p - 1) + g) / p;
    loss = (loss * (p - 1) + l) / p;
    out[k] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function stochRsiK(close, rsiP = 14, stLen = 14) {
  const rsi = rsiWilder(close, rsiP);
  const k = Array(close.length).fill(Number.NaN);
  for (let idx = 0; idx < close.length; idx++) {
    if (idx < rsiP + stLen) continue;
    let lo = Infinity,
      hi = -Infinity;
    for (let j = idx - stLen + 1; j <= idx; j++) {
      lo = Math.min(lo, rsi[j]);
      hi = Math.max(hi, rsi[j]);
    }
    const v = rsi[idx];
    k[idx] = hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0;
  }
  return k;
}

function maxPrior(arr, idx, lb, excludeRecent = 2) {
  const end = idx - 1 - excludeRecent;
  const start = Math.max(0, idx - lb);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, arr[j]);
  return m;
}

function hvnBarRange(vol, high, low, idx, lb) {
  let bestJ = Math.max(0, idx - lb);
  let bestV = -Infinity;
  for (let j = Math.max(0, idx - lb); j < idx; j++) {
    if (Number.isFinite(vol[j]) && vol[j] > bestV) {
      bestV = vol[j];
      bestJ = j;
    }
  }
  return { high: high[bestJ], low: low[bestJ], j: bestJ, v: bestV };
}

const volSma = sma(V, volSmaP);
const volRatio = V[i] / volSma[i];
const volOk = Number.isFinite(volRatio) && volRatio > volMult;

const swingExclude = 2;
const hhRef = maxPrior(H, i, lookback, swingExclude);
const hhOk = Number.isFinite(hhRef) && C[i] > hhRef; // close break (non-intrabar)

const hvn = hvnBarRange(V, H, L, i, innerLb);
const svpClearOk = Number.isFinite(hvn.high) && C[i] > hvn.high;

const e20 = ema(C, 20);
const e50 = ema(C, 50);
const slope2 = (e, idx) =>
  idx >= 2 &&
  Number.isFinite(e[idx]) &&
  Number.isFinite(e[idx - 1]) &&
  Number.isFinite(e[idx - 2]) &&
  e[idx] > e[idx - 1] &&
  e[idx - 1] > e[idx - 2];
const ema20Ok = slope2(e20, i);
const ema50Ok = slope2(e50, i);

const stochK = stochRsiK(C, 14, 14);
const snowballLongOk = hhOk && volOk && svpClearOk && ema20Ok && ema50Ok;

console.log(
  JSON.stringify(
    {
      symbol: sym,
      lastClosedIndex: i,
      close: C[i],
      hhRef,
      swingExcludeRecent: swingExclude,
      hhOk,
      vol: V[i],
      volSma: volSma[i],
      volRatio,
      volGate: volMult,
      volOk,
      hvnHigh: hvn.high,
      hvnLow: hvn.low,
      hvnIdx: hvn.j,
      hvnVol: hvn.v,
      svpClearOk,
      ema20: e20[i],
      ema50: e50[i],
      ema20Ok,
      ema50Ok,
      stochK: stochK[i],
      stochLongFilter: false,
      snowballLongOk,
    },
    null,
    2,
  ),
);

