// tools/make_fixtures.py と同じ式で作る合成信号
export const SR = 22050;
export const HZ = 50;
const BPM = 128;
const PERIOD = 60 / BPM;
const T0 = 0.5;
export const DUR = 30;

export function beatAudio(sr = SR, dur = DUR): Float32Array {
  const n = Math.floor(dur * sr);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = Math.floor((t - T0) / PERIOD);
    const dt = t - (T0 + k * PERIOD);
    const on = t >= T0;
    const kick = on ? 0.8 * Math.exp(-dt / 0.03) * Math.sin(2 * Math.PI * 60 * dt) : 0;
    const dh = dt - PERIOD / 2;
    const hat = on && dh >= 0 ? 0.2 * Math.exp(-Math.max(dh, 0) / 0.008) * Math.sin(2 * Math.PI * 7000 * dh + 3 * Math.sin(2 * Math.PI * 1300 * dh)) : 0;
    const pad = 0.1 * Math.sin(2 * Math.PI * 220 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * t));
    y[i] = kick + hat + pad;
  }
  return y;
}

export function motionSignal(n: number, lagS: number): Float64Array {
  const beats = Array.from({ length: Math.floor(DUR / PERIOD) + 2 }, (_, j) => T0 + j * PERIOD);
  const m = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let peak = 0;
    for (const b of beats) peak = Math.max(peak, Math.exp(-(((k / HZ - (b + lagS)) / 0.04) ** 2)));
    m[k] = 1000 * peak + 80 * Math.sin(k * 0.37) ** 2 + 30 * Math.sin(k * 1.9) ** 2;
  }
  return m;
}

export function tones(sr: number, dur: number): Float32Array {
  const n = Math.floor(dur * sr);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    y[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 5000 * t) + 0.15 * Math.sin(2 * Math.PI * 10500 * t) + 0.05 * Math.sin(2 * Math.PI * 12000 * t);
  }
  return y;
}
