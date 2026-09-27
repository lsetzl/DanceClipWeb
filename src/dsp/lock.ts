// GUI版 dc/auto_sync.py の beat_lock の移植
import { highpass } from './filter';
import { HZ } from './onset';
import { roundHalfEven } from './round';

export const hpCutoff = (bpm: number) => Math.max(0.5, bpm / 120);

function normalize(x: Float64Array): Float64Array {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  const y = x.map((v) => v - mean);
  let n = 0;
  for (const v of y) n += v * v;
  n = Math.sqrt(n);
  return n > 1e-9 ? y.map((v) => v / n) : y;
}

// lag > 0 は動画側を後ろにずらすと合う = video_ref を増やす方向
function correlationCurve(motion: Float64Array, audio: Float64Array, maxLag: number): Float64Array {
  const L = Math.min(motion.length, audio.length);
  const curve = new Float64Array(2 * maxLag + 1).fill(-Infinity);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const m = lag >= 0 ? motion.subarray(lag, L) : motion.subarray(0, L + lag);
    const a = lag >= 0 ? audio.subarray(0, L - lag) : audio.subarray(-lag, L);
    if (m.length < 8) continue;
    const nm = normalize(m), na = normalize(a);
    let s = 0;
    for (let i = 0; i < nm.length; i++) s += nm[i] * na[i];
    curve[lag + maxLag] = s;
  }
  return curve;
}

export class LockError extends Error {}

function windows(motion: ArrayLike<number>, onset: ArrayLike<number>, vRefMs: number, aRefMs: number, halfS: number, maxLag: number) {
  const vRef = vRefMs / 1000, aRef = aRefMs / 1000;
  const pre = Math.max(0, Math.min(halfS, vRef, aRef));
  const iv = roundHalfEven((vRef - pre) * HZ);
  const ia = roundHalfEven((aRef - pre) * HZ);
  const n = roundHalfEven((pre + halfS) * HZ);
  const m = Float64Array.from(Array.prototype.slice.call(motion, iv, iv + n));
  const a = Float64Array.from(Array.prototype.slice.call(onset, ia, ia + n));
  const need = Math.max(HZ * 2, maxLag * 2 + 8);
  if (m.length < need || a.length < need) throw new LockError('too-short');
  return { m, a };
}

export interface LockResult {
  video_ref_ms: number;
  delta_ms: number;
  raw_delta_ms: number;
  correlation: number;
  applied: boolean;
}

export function beatLock(
  motion: ArrayLike<number>,
  onset: ArrayLike<number>,
  vRefMs: number,
  aRefMs: number,
  bpm: number,
  windowS = 8,
  searchBeats = 0.5,
  minCorrelation = 0.03,
): LockResult {
  const maxLag = roundHalfEven(((60000 / bpm) * searchBeats / 1000) * HZ);
  const { m, a } = windows(motion, onset, vRefMs, aRefMs, windowS / 2, maxLag);
  const fc = hpCutoff(bpm);
  const curve = correlationCurve(highpass(m, fc, HZ), highpass(a, fc, HZ), maxLag);
  let best = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i] > curve[best]) best = i;
  const delta = roundHalfEven(((best - maxLag) * 1000) / HZ);
  const corr = curve[best];
  const applied = corr >= minCorrelation;
  return {
    video_ref_ms: vRefMs + (applied ? delta : 0),
    delta_ms: applied ? delta : 0,
    raw_delta_ms: delta,
    correlation: corr,
    applied,
  };
}

// 何度押しても同じ位置に落ち着く版。動画側は再生位置の前後を固定し、曲側だけをずらして比べる。
// 探す範囲は searchCenterMs(省略時は今の同期)の ±半拍。同じ中心で探し直せば同じ答えになる
export function beatLockStable(
  motion: ArrayLike<number>,
  onset: ArrayLike<number>,
  vAnchorMs: number,
  offsetMs: number,
  bpm: number,
  searchCenterMs = offsetMs,
  windowS = 8,
  searchBeats = 0.5,
  minCorrelation = 0.03,
): Omit<LockResult, 'video_ref_ms'> {
  const maxLag = roundHalfEven(((60000 / bpm) * searchBeats / 1000) * HZ);
  const n = roundHalfEven(windowS * HZ);
  const vs = Math.max(0, roundHalfEven((vAnchorMs / 1000) * HZ) - Math.floor(n / 2));
  const len = Math.min(n, motion.length - vs);
  if (len < Math.max(HZ * 2, maxLag * 2 + 8)) throw new LockError('too-short');
  const fc = hpCutoff(bpm);
  const hm = normalize(highpass(Array.prototype.slice.call(motion, vs, vs + len), fc, HZ));
  // 押すたびに丸めの向きが変わらないよう、ここは偶数丸めではなく常に同じ向きに丸める
  const d0 = Math.round((searchCenterMs / 1000) * HZ);

  // lag > 0 は video_ref を増やす方向。曲側の区間は lag の分だけ前に来る
  let best = -Infinity, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const as = vs - d0 - lag;
    if (as < 0 || as + len > onset.length) continue;
    const ha = normalize(highpass(Array.prototype.slice.call(onset, as, as + len), fc, HZ));
    let s = 0;
    for (let i = 0; i < len; i++) s += hm[i] * ha[i];
    if (s > best || (s === best && Math.abs(lag) < Math.abs(bestLag))) {
      best = s;
      bestLag = lag;
    }
  }
  if (best === -Infinity) throw new LockError('too-short');
  const delta = Math.round(searchCenterMs + (bestLag * 1000) / HZ - offsetMs);
  const applied = best >= minCorrelation;
  return {
    delta_ms: applied ? delta : 0,
    raw_delta_ms: delta,
    correlation: best,
    applied,
  };
}
