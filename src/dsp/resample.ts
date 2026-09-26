// ffmpeg(libswresample)の既定のリサンプラー(Kaiser 窓 sinc、filter_size=32、cutoff=0.97、beta=9)に寄せた実装。
// GUI版は ffmpeg で 22050Hz にしてから librosa に渡していたので、拍の位置を揃えるために同じ特性にする

function besselI0(x: number) {
  let v = 1, t = 1;
  for (let i = 1; i < 50; i++) {
    t *= (x / (2 * i)) ** 2;
    v += t;
    if (t < v * 1e-12) break;
  }
  return v;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function resample(x: Float32Array, inRate: number, outRate: number, filterSize = 32, cutoff = 0.97, beta = 9): Float32Array {
  if (inRate === outRate) return x.slice();
  const g = gcd(inRate, outRate);
  const up = outRate / g, down = inRate / g;
  const factor = Math.min((outRate * cutoff) / inRate, 1);
  const taps = Math.max(Math.ceil(filterSize / factor), 1);
  const center = Math.floor((taps - 1) / 2);

  // 位相ごとのフィルタ(位相 ph は出力サンプルの入力上の小数位置 ph/up)
  const bank: Float64Array[] = [];
  for (let ph = 0; ph < up; ph++) {
    const h = new Float64Array(taps);
    let norm = 0;
    for (let i = 0; i < taps; i++) {
      const xx = Math.PI * (i - center - ph / up) * factor;
      let y = xx === 0 ? 1 : Math.sin(xx) / xx;
      const w = (2 * xx) / (factor * taps * Math.PI);
      y *= besselI0(beta * Math.sqrt(Math.max(1 - w * w, 0)));
      h[i] = y;
      norm += y;
    }
    for (let i = 0; i < taps; i++) h[i] /= norm;
    bank.push(h);
  }

  const n = Math.ceil((x.length * up) / down);
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const pos = j * down;
    const idx = Math.floor(pos / up);
    const h = bank[pos % up];
    let s = 0;
    const base = idx - center;
    for (let i = 0; i < taps; i++) {
      const k = base + i;
      if (k >= 0 && k < x.length) s += h[i] * x[k];
    }
    out[j] = s;
  }
  return out;
}
