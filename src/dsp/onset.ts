// librosa.onset.onset_strength(y, sr=22050, hop_length=441) の移植(既定: n_fft=2048, 128メル, Slaney)
import { fft } from './fft';

export const SR = 22050;
export const HZ = 50;
export const HOP = SR / HZ;
const N_FFT = 2048;
const N_MELS = 128;

function hzToMel(f: number) {
  const fSp = 200 / 3;
  const minLogHz = 1000, minLogMel = minLogHz / fSp, logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fSp;
}

function melToHz(m: number) {
  const fSp = 200 / 3;
  const minLogHz = 1000, minLogMel = minLogHz / fSp, logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fSp * m;
}

function melFilterbank(sr: number, nFft: number, nMels: number): Float64Array[] {
  const nBins = nFft / 2 + 1;
  const fftFreqs = Array.from({ length: nBins }, (_, i) => (i * sr) / nFft);
  const mMin = hzToMel(0), mMax = hzToMel(sr / 2);
  const melF = Array.from({ length: nMels + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1)));
  const weights: Float64Array[] = [];
  for (let i = 0; i < nMels; i++) {
    const w = new Float64Array(nBins);
    const d0 = melF[i + 1] - melF[i], d1 = melF[i + 2] - melF[i + 1];
    const enorm = 2 / (melF[i + 2] - melF[i]);
    for (let k = 0; k < nBins; k++) {
      const lower = (fftFreqs[k] - melF[i]) / d0;
      const upper = (melF[i + 2] - fftFreqs[k]) / d1;
      w[k] = Math.max(0, Math.min(lower, upper)) * enorm;
    }
    weights.push(w);
  }
  return weights;
}

export function onsetStrength(y: Float32Array, onProgress?: (f: number) => void): Float32Array {
  const pad = N_FFT / 2;
  const nFrames = 1 + Math.floor(y.length / HOP);
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const mel = melFilterbank(SR, N_FFT, N_MELS);
  const ranges = mel.map((w) => {
    let a = 0;
    while (a < w.length && w[a] === 0) a++;
    let b = w.length - 1;
    while (b > a && w[b] === 0) b--;
    return [a, b] as const;
  });

  const db = new Float32Array(nFrames * N_MELS);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const power = new Float64Array(N_FFT / 2 + 1);
  let maxDb = -Infinity;
  for (let t = 0; t < nFrames; t++) {
    const start = t * HOP - pad;
    for (let i = 0; i < N_FFT; i++) {
      const j = start + i;
      re[i] = j >= 0 && j < y.length ? y[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= N_FFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < N_MELS; m++) {
      const w = mel[m];
      const [a, b] = ranges[m];
      let s = 0;
      for (let k = a; k <= b; k++) s += w[k] * power[k];
      const v = 10 * Math.log10(Math.max(1e-10, s));
      db[t * N_MELS + m] = v;
      if (v > maxDb) maxDb = v;
    }
    if (onProgress && t % 500 === 0) onProgress(t / nFrames);
  }
  const floor = maxDb - 80;
  for (let i = 0; i < db.length; i++) if (db[i] < floor) db[i] = floor;

  const lag = 1;
  const padWidth = lag + Math.floor(N_FFT / (2 * HOP));
  const out = new Float32Array(nFrames);
  for (let t = lag; t < nFrames; t++) {
    let s = 0;
    for (let m = 0; m < N_MELS; m++) {
      const d = db[t * N_MELS + m] - db[(t - lag) * N_MELS + m];
      if (d > 0) s += d;
    }
    const o = t - lag + padWidth;
    if (o < nFrames) out[o] = s / N_MELS;
  }
  return out;
}
