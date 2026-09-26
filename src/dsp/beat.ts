// librosa.feature.tempo と librosa.beat.beat_track の移植(onset は 50Hz)
import { fft, nextPow2 } from './fft';
import { HZ, HOP, SR } from './onset';
import { roundHalfEven } from './round';

export const BPM_MIN = 80;
export const BPM_MAX = 160;

export function tempo(onset: ArrayLike<number>, startBpm = 120, stdBpm = 1, acSize = 8, maxTempo = 320): number {
  const win = Math.floor((acSize * SR) / HOP);
  const n = onset.length;
  const half = Math.floor(win / 2);
  const padded = new Float64Array(n + 2 * half);
  for (let i = 0; i < half; i++) padded[i] = (onset[0] * i) / half;
  for (let i = 0; i < n; i++) padded[half + i] = onset[i];
  for (let i = 0; i < half; i++) padded[half + n + i] = (onset[n - 1] * (half - 1 - i)) / half;

  const hann = new Float64Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);

  const m = nextPow2(2 * win - 1);
  const re = new Float64Array(m), im = new Float64Array(m);
  const mean = new Float64Array(win);
  for (let t = 0; t < n; t++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i++) re[i] = padded[t + i] * hann[i];
    fft(re, im);
    for (let k = 0; k < m; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft(re, im, true);
    let mx = 0;
    for (let i = 0; i < win; i++) mx = Math.max(mx, Math.abs(re[i]));
    const s = mx > 1e-300 * m ? mx : m;
    for (let i = 0; i < win; i++) mean[i] += re[i] / s;
  }
  let best = -Infinity, bestBpm = startBpm;
  for (let i = 1; i < win; i++) {
    const bpm = (60 * SR) / (HOP * i);
    if (bpm >= maxTempo) continue;
    const prior = -0.5 * ((Math.log2(bpm) - Math.log2(startBpm)) / stdBpm) ** 2;
    const score = Math.log1p(1e6 * (mean[i] / n)) + prior;
    if (score > best) {
      best = score;
      bestBpm = bpm;
    }
  }
  return bestBpm;
}

export function constrainBpm(bpm: number) {
  if (!(bpm > 0)) return 120;
  while (bpm < BPM_MIN) bpm *= 2;
  while (bpm > BPM_MAX) bpm /= 2;
  return bpm;
}

// center が null なら曲の冒頭から spanS 秒
export function estimateBpm(onset: ArrayLike<number>, centerS: number | null = null, spanS = 90): number {
  const n = Math.floor(spanS * HZ);
  const i0 = centerS == null ? 0 : Math.floor(Math.max(0, Math.min(onset.length - n, centerS * HZ - n / 2)));
  let seg: ArrayLike<number> = Array.prototype.slice.call(onset, i0, i0 + n);
  if (seg.length < HZ * 4) seg = onset;
  return constrainBpm(tempo(seg));
}

export function beatTrack(onset: ArrayLike<number>, bpm: number, tightness = 100, trim = true): number[] {
  const n = onset.length;
  let any = false;
  for (let i = 0; i < n; i++) if (onset[i]) { any = true; break; }
  if (!any) return [];

  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (onset[i] - mean) ** 2;
  const std = Math.sqrt(v / (n - 1)) + 1.1754943508222875e-38;
  const norm = Float64Array.from(onset, (x) => x / std);

  const fpb = roundHalfEven((HZ * 60) / bpm);
  const K = 2 * fpb + 1;
  const window = new Float64Array(K);
  for (let k = 0; k < K; k++) window[k] = Math.exp(-0.5 * (((k - fpb) * 32) / fpb) ** 2);
  const K2 = Math.floor(K / 2);
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = Math.max(0, i + K2 - n + 1); k < Math.min(i + K2, K); k++) s += window[k] * norm[i + K2 - k];
    local[i] = s;
  }

  let lmax = -Infinity;
  for (let i = 0; i < n; i++) lmax = Math.max(lmax, local[i]);
  const thresh = 0.01 * lmax;
  const backlink = new Int32Array(n);
  const cum = new Float64Array(n);
  let first = true;
  const logFpb = Math.log(fpb);
  const hi = roundHalfEven(fpb / 2);
  for (let i = 0; i < n; i++) {
    let bestScore = -Infinity, loc = -1;
    for (let l = i - hi; l > i - 2 * fpb - 1; l--) {
      if (l < 0) break;
      const s = cum[l] - tightness * (Math.log(i - l) - logFpb) ** 2;
      if (s > bestScore) {
        bestScore = s;
        loc = l;
      }
    }
    cum[i] = loc >= 0 ? local[i] + bestScore : local[i];
    if (first && local[i] < thresh) backlink[i] = -1;
    else {
      backlink[i] = loc;
      first = false;
    }
  }

  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? cum[i - 1] : cum[0];
    const next = i < n - 1 ? cum[i + 1] : cum[n - 1];
    if (cum[i] > prev && cum[i] >= next) peaks.push(cum[i]);
  }
  peaks.sort((a, b) => a - b);
  const med = peaks.length ? (peaks.length % 2 ? peaks[(peaks.length - 1) / 2] : (peaks[peaks.length / 2 - 1] + peaks[peaks.length / 2]) / 2) : 0;
  const th = 0.5 * med;
  let tail = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    const prev = i > 0 ? cum[i - 1] : cum[0];
    const next = i < n - 1 ? cum[i + 1] : cum[n - 1];
    const isMax = cum[i] > prev && cum[i] >= next;
    if (isMax && cum[i] >= th) {
      tail = i;
      break;
    }
  }

  const beats = new Uint8Array(n);
  for (let i = tail; i >= 0; i = backlink[i]) beats[i] = 1;

  const bl: number[] = [];
  for (let i = 0; i < n; i++) if (beats[i]) bl.push(local[i]);
  const w = [0, 0.5, 1, 0.5, 0];
  const full = new Float64Array(bl.length + w.length - 1);
  for (let i = 0; i < bl.length; i++) for (let k = 0; k < w.length; k++) full[i + k] += bl[i] * w[k];
  const smooth = full.slice(2, n + 2);
  let sq = 0;
  for (const s of smooth) sq += s * s;
  const threshold = trim ? 0.5 * Math.sqrt(sq / smooth.length) : 0;
  for (let i = 0; i < n && local[i] <= threshold; i++) beats[i] = 0;
  for (let i = n - 1; i >= 0 && local[i] <= threshold; i--) beats[i] = 0;

  const out: number[] = [];
  for (let i = 0; i < n; i++) if (beats[i]) out.push((i * HOP) / SR);
  return out;
}
