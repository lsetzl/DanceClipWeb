// 小節の頭(4 拍子を仮定)の推定。拍ごとに「コードの変化」と「キックの強さ」を点数にし、
// 4 通りの位相のうち点数の合計が最大のものを選ぶ。あくまで最初の候補で、ユーザーが 1 拍ずつ直せる前提
import type { SpectralExtras } from './onset';
import { HZ } from './onset';

function zscore(x: Float64Array) {
  let m = 0;
  for (const v of x) m += v;
  m /= x.length || 1;
  let s = 0;
  for (const v of x) s += (v - m) ** 2;
  s = Math.sqrt(s / (x.length || 1)) || 1;
  return x.map((v) => (v - m) / s);
}

// 拍 i の「小節の頭らしさ」
export function beatScores(beats: number[], extras: SpectralExtras, lowWeight = 0.5): Float64Array {
  const nFrames = extras.low.length;
  const f = beats.map((t) => Math.min(nFrames - 1, Math.max(0, Math.round(t * HZ))));
  const n = beats.length;
  const change = new Float64Array(n);
  const kick = new Float64Array(n);
  const meanChroma = (a: number, b: number) => {
    const c = new Float64Array(12);
    for (let t = a; t < b; t++) {
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += extras.chroma[t * 12 + k];
      if (sum <= 0) continue;
      for (let k = 0; k < 12; k++) c[k] += extras.chroma[t * 12 + k] / sum;
    }
    const norm = Math.hypot(...c) || 1;
    return c.map((v) => v / norm);
  };
  for (let i = 1; i < n - 1; i++) {
    const prev = meanChroma(f[i - 1], f[i]), next = meanChroma(f[i], f[i + 1]);
    let dot = 0;
    for (let k = 0; k < 12; k++) dot += prev[k] * next[k];
    change[i] = 1 - dot;
    let peak = -Infinity;
    for (let t = Math.max(0, f[i] - 2); t <= Math.min(nFrames - 1, f[i] + 3); t++) peak = Math.max(peak, extras.low[t]);
    let base = 0, cnt = 0;
    for (let t = f[i - 1]; t < f[i + 1]; t++) {
      base += extras.low[t];
      cnt++;
    }
    kick[i] = peak - base / (cnt || 1);
  }
  const zc = zscore(change), zk = zscore(kick);
  return zc.map((v, i) => v + lowWeight * zk[i]);
}

// 曲全体で 1 つの位相。beats[i] は (i - phase) % 4 === 0 のとき小節の頭
export function estimateBarPhase(beats: number[], extras: SpectralExtras, lowWeight = 0.5): number {
  const s = beatScores(beats, extras, lowWeight);
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < s.length; i++) sum[i % 4] += s[i];
  return sum.indexOf(Math.max(...sum));
}

// 区間ごとの位相(前後 halfWindow 拍の点数で決める)。途中で小節がずれる曲向け
export function estimateBarPhases(beats: number[], extras: SpectralExtras, halfWindow = 16, lowWeight = 0.5): Int8Array {
  const s = beatScores(beats, extras, lowWeight);
  const out = new Int8Array(beats.length);
  for (let i = 0; i < s.length; i++) {
    const sum = [0, 0, 0, 0];
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(s.length - 1, i + halfWindow); j++) sum[j % 4] += s[j];
    out[i] = sum.indexOf(Math.max(...sum));
  }
  return out;
}
