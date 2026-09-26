// scipy.signal.butter(4, fc, 'high', fs=fs, output='sos') と sosfiltfilt の移植

type Sos = [number, number, number, number, number, number][];

interface C { re: number; im: number }
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C) => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C) => c(a.re - b.re, a.im - b.im);
const div = (a: C, b: C) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};

export function butterHighpassSos(order: number, cutoffHz: number, fs: number): Sos {
  const wn = (2 * cutoffHz) / fs;
  const fs2 = 2 * 2;
  const warped = 2 * 2 * Math.tan((Math.PI * wn) / 2);
  const poles: C[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const a = (Math.PI * m) / (2 * order);
    const p = c(-Math.cos(a), -Math.sin(a));
    const php = div(c(warped), p);
    poles.push(div(add(c(fs2), php), sub(c(fs2), php)));
  }
  // 共役対ごとに2次セクションにする。零点は z=1 の重根。各セクションはナイキストで利得 1
  const sos: Sos = [];
  for (const p of poles.filter((p) => p.im > 1e-12)) {
    const a1 = -2 * p.re;
    const a2 = p.re * p.re + p.im * p.im;
    const g = (1 - a1 + a2) / 4;
    sos.push([g, -2 * g, g, 1, a1, a2]);
  }
  return sos;
}

function sosfiltZi(sos: Sos): [number, number][] {
  let scale = 1;
  return sos.map(([b0, b1, b2, , a1, a2]) => {
    const B0 = b1 - a1 * b0, B1 = b2 - a2 * b0;
    // [[1+a1, -1],[a2, 1]] z = [B0, B1]
    const det = (1 + a1) + a2;
    const z0 = (B0 + B1) / det;
    const z1 = B1 - a2 * z0;
    const zi: [number, number] = [scale * z0, scale * z1];
    scale *= (b0 + b1 + b2) / (1 + a1 + a2);
    return zi;
  });
}

function sosfilt(sos: Sos, x: Float64Array, zi: [number, number][], x0: number): Float64Array {
  let y = Float64Array.from(x);
  sos.forEach(([b0, b1, b2, , a1, a2], s) => {
    let z0 = zi[s][0] * x0, z1 = zi[s][1] * x0;
    const out = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = b0 * xi + z0;
      z0 = b1 * xi - a1 * yi + z1;
      z1 = b2 * xi - a2 * yi;
      out[i] = yi;
    }
    y = out;
  });
  return y;
}

export function sosfiltfilt(sos: Sos, xIn: ArrayLike<number>): Float64Array {
  const n = xIn.length;
  const padlen = 3 * (2 * sos.length + 1);
  if (n <= padlen) return Float64Array.from(xIn);
  const ext = new Float64Array(n + 2 * padlen);
  const x0 = xIn[0], xn = xIn[n - 1];
  for (let i = 0; i < padlen; i++) ext[i] = 2 * x0 - xIn[padlen - i];
  for (let i = 0; i < n; i++) ext[padlen + i] = xIn[i];
  for (let i = 0; i < padlen; i++) ext[padlen + n + i] = 2 * xn - xIn[n - 2 - i];
  const zi = sosfiltZi(sos);
  const fwd = sosfilt(sos, ext, zi, ext[0]);
  fwd.reverse();
  const bwd = sosfilt(sos, fwd, zi, fwd[0]);
  bwd.reverse();
  return bwd.slice(padlen, padlen + n);
}

export function highpass(x: ArrayLike<number>, cutoffHz: number, fs: number): Float64Array {
  if (x.length < 30) return Float64Array.from(x);
  return sosfiltfilt(butterHighpassSos(4, cutoffHz, fs), x);
}
