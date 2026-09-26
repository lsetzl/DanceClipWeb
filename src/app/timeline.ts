import { t } from '../i18n';
import { addMarker, changed, removeMarker, setTrim } from './actions';
import { currentSongTime, P } from './player';
import { clamp, MIN_TRIM_MS, offsetS, PEAK_HZ, ready, S, SNAP_PX, trimS, videoPosMs } from './state';
import { $, fmt } from './ui';

interface Cv { c: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number }
const CV: Record<string, Cv> = {};

function setupCanvas(id: string) {
  const c = $<HTMLCanvasElement>(id);
  CV[id] = { c, g: c.getContext('2d')!, w: 0, h: 0 };
}

export function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const k in CV) {
    const o = CV[k];
    const r = o.c.getBoundingClientRect();
    o.w = r.width;
    o.h = r.height;
    o.c.width = Math.round(r.width * dpr);
    o.c.height = Math.round(r.height * dpr);
    o.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  S.dirty = true;
}

const COL = {
  bg: '#101218', marker: '#ff7ad9', ruler: '#171a21', grid: '#262b36', text: '#8b92a3', motion: '#57d5e6',
  wave: '#56607a', play: '#ffffff', accent: '#4fb3ff', fade: '#ffc24f', shade: 'rgba(0,0,0,0.58)',
  beatSong: 'rgba(255,194,79,0.85)', beatVideo: 'rgba(255,194,79,0.35)', outside: '#08090c',
};
const LAYOUT = { ruler: 18, song: 96, gap: 3 };
const lanes = (h: number) => {
  const SY = LAYOUT.ruler, SH = Math.min(LAYOUT.song, Math.round((h - LAYOUT.ruler) * 0.42)), VY = SY + SH + LAYOUT.gap;
  return { R: LAYOUT.ruler, SY, SH, VY, VH: h - VY };
};
type Lanes = ReturnType<typeof lanes>;

// メインの表示範囲。時間軸は曲に固定し、動画は offset だけずれた位置に描く
export const V = { t0: 0, t1: 1 };

function viewBounds() {
  const off = offsetS();
  const lo = Math.min(0, -off), hi = Math.max(S.aDur || 0, (S.vDur || 0) - off, lo + 1);
  return { lo, hi };
}
function scrollRange(span: number) {
  const { lo, hi } = viewBounds();
  const pad = Math.max(span * 0.1, (hi - lo) * 0.03);
  return { min: lo - pad, max: hi + pad };
}
export function viewSet(t0: number, t1: number) {
  const { lo, hi } = viewBounds();
  const span = clamp(t1 - t0, 0.5, (hi - lo) * 1.1);
  const r = scrollRange(span);
  V.t0 = clamp(t0, r.min, Math.max(r.min, r.max - span));
  V.t1 = V.t0 + span;
  S.dirty = true;
}
const viewPan = (dt: number) => viewSet(V.t0 + dt, V.t1 + dt);
export function ensureVisible(s: number) {
  const span = V.t1 - V.t0;
  if (s < V.t0 || s > V.t1) viewSet(s - span * 0.3, s + span * 0.7);
}
export function viewFit() {
  const off = offsetS(), d = S.vDur || 1;
  viewSet(-off - d * 0.01, -off + d * 1.01);
}
export function viewSong() {
  const { lo, hi } = viewBounds();
  const m = (hi - lo) * 0.01;
  viewSet(lo - m, hi + m);
}
export function viewTrim() {
  const tr = trimS();
  if (!tr) return;
  const off = offsetS(), m = (tr.end - tr.start) * 0.04;
  viewSet(tr.start - off - m, tr.end - off + m);
}
export const zoomAt = (s: number, factor: number) => viewSet(s - (s - V.t0) * factor, s + (V.t1 - s) * factor);
const xOf = (s: number, w: number) => ((s - V.t0) / (V.t1 - V.t0)) * w;
const tOf = (x: number, w: number) => V.t0 + (x / w) * (V.t1 - V.t0);
const xvOf = (tv: number, w: number) => xOf(tv - offsetS(), w);
const tvOf = (x: number, w: number) => tOf(x, w) + offsetS();

function tickStep(span: number, w: number, minPx: number) {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  return steps.find((s) => w / (span / s) >= minPx) || 120;
}
function tickLabel(tm: number, step: number) {
  const s = fmt(tm);
  return step < 1 ? s : s.replace(/\.\d+$/, '');
}
// x = (t - a) / (b - a) * w の目盛りを y0..y1 に描く
function drawTicks(g: CanvasRenderingContext2D, w: number, a: number, b: number, y0: number, y1: number, labelY: number | null, color = COL.text) {
  const step = tickStep(b - a, w, 70);
  g.strokeStyle = COL.grid;
  g.fillStyle = color;
  g.lineWidth = 1;
  g.font = '10px Consolas, monospace';
  for (let tm = Math.ceil(a / step) * step; tm <= b; tm += step) {
    const x = Math.round(((tm - a) / (b - a)) * w) + 0.5;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, y1);
    g.stroke();
    if (labelY != null) g.fillText(tickLabel(tm, step), x + 3, labelY);
  }
}

function vline(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, color: string, width = 1) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(Math.round(x) + 0.5, y0);
  g.lineTo(Math.round(x) + 0.5, y1);
  g.stroke();
  g.restore();
}

function drawMotion(g: CanvasRenderingContext2D, w: number, y: number, h: number) {
  const motion = S.motion;
  if (!motion) return;
  const hz = S.hz, n = motion.length;
  const v0 = tvOf(0, w), v1 = tvOf(w, w);
  const i0 = Math.max(0, Math.floor(v0 * hz)), i1 = Math.min(n - 1, Math.ceil(v1 * hz));
  if (i1 <= i0) return;
  let hi = 0;
  for (let i = i0; i <= i1; i++) if (motion[i] > hi) hi = motion[i];
  hi = Math.max(hi, S.motionScale * 0.15, 1e-6);
  const yv = (v: number) => y + h - 14 - Math.min(1, v / hi) * (h - 22);
  const base = y + h - 12;
  const perPx = (i1 - i0) / w;
  g.beginPath();
  g.moveTo(xvOf(i0 / hz, w), base);
  if (perPx > 1) {
    const px0 = Math.max(0, Math.floor(xvOf(i0 / hz, w))), px1 = Math.min(w, Math.ceil(xvOf(i1 / hz, w)));
    for (let px = px0; px < px1; px++) {
      const a = Math.max(0, Math.floor(tvOf(px, w) * hz)), b = Math.min(n - 1, Math.floor(tvOf(px + 1, w) * hz));
      let m = 0;
      for (let i = a; i <= b; i++) if (motion[i] > m) m = motion[i];
      g.lineTo(px, yv(m));
    }
    g.lineTo(px1, base);
  } else {
    for (let i = i0; i <= i1; i++) g.lineTo(xvOf(i / hz, w), yv(motion[i]));
    g.lineTo(xvOf(i1 / hz, w), base);
  }
  g.closePath();
  g.fillStyle = 'rgba(87,213,230,0.28)';
  g.fill();
  g.strokeStyle = COL.motion;
  g.lineWidth = 1.2;
  g.stroke();
}

function drawWave(g: CanvasRenderingContext2D, w: number, y: number, h: number) {
  const peaks = S.peaks;
  if (!peaks) return;
  const n = peaks.length, mid = y + h / 2;
  g.fillStyle = COL.wave;
  for (let px = 0; px < w; px++) {
    const s0 = tOf(px, w), s1 = tOf(px + 1, w);
    if (s1 < 0 || s0 > S.aDur) continue;
    const a = Math.max(0, Math.floor(s0 * PEAK_HZ)), b = Math.min(n - 1, Math.max(a, Math.floor(s1 * PEAK_HZ)));
    let m = 0;
    for (let i = a; i <= b; i++) if (peaks[i] > m) m = peaks[i];
    const hh = Math.max(0.5, m * (h / 2 - 3));
    g.fillRect(px, mid - hh, 1, hh * 2);
  }
}

function fadeHandles(w: number) {
  const tr = trimS();
  if (!tr || !S.p) return null;
  const fin = S.p.fade.in_ms / 1000, fout = S.p.fade.out_ms / 1000;
  return {
    t: tr, fin, fout,
    xs: xvOf(tr.start, w), xe: xvOf(tr.end, w),
    xfi: xvOf(tr.start + fin, w), xfo: xvOf(tr.end - fout, w),
  };
}

// 目印のつまみは動画レーン下部(フェードの丸と重ならない高さ)に置く
const markerKnobY = (L: Lanes) => L.VY + L.VH - 22;

function drawMarkers(g: CanvasRenderingContext2D, w: number, L: Lanes) {
  const snapped = TL.dragging?.snapIdx;
  S.p!.markers.forEach((m, i) => {
    const x = xvOf(m / 1000, w);
    if (x < -8 || x > w + 8) return;
    const hot = snapped === i;
    vline(g, x, L.SY, L.VY + L.VH - 12, hot ? '#ffffff' : COL.marker, hot ? 2 : 1.5);
    const y = markerKnobY(L);
    g.fillStyle = hot ? '#ffffff' : COL.marker;
    g.beginPath();
    g.moveTo(x, y - 7);
    g.lineTo(x + 6, y);
    g.lineTo(x, y + 7);
    g.lineTo(x - 6, y);
    g.closePath();
    g.fill();
  });
}

function drawMain() {
  const { g, w, h } = CV['#cvMain'];
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, w, h);
  if (!S.p || !S.vDur) return;
  const L = lanes(h);
  const off = offsetS();
  const x = (s: number) => xOf(s, w);
  const xv = (tv: number) => xvOf(tv, w);

  g.fillStyle = COL.ruler;
  g.fillRect(0, 0, w, L.R);
  drawTicks(g, w, V.t0, V.t1, L.R - 6, L.R, 11);

  g.fillStyle = COL.outside;
  if (x(0) > 0) g.fillRect(0, L.SY, Math.min(w, x(0)), L.SH);
  if (x(S.aDur) < w) g.fillRect(Math.max(0, x(S.aDur)), L.SY, w - Math.max(0, x(S.aDur)), L.SH);
  g.fillRect(0, L.VY, w, L.VH);
  const xv0 = Math.max(0, xv(0)), xv1 = Math.min(w, xv(S.vDur));
  if (xv1 > xv0) {
    g.fillStyle = '#151922';
    g.fillRect(xv0, L.VY, xv1 - xv0, L.VH);
    g.strokeStyle = '#3a4252';
    g.lineWidth = 1;
    g.strokeRect(xv(0) + 0.5, L.VY + 0.5, xv(S.vDur) - xv(0) - 1, L.VH - 1);
  }

  drawWave(g, w, L.SY, L.SH);
  drawMotion(g, w, L.VY, L.VH);
  const beats = S.beats;
  if (beats && beats.length > 1) {
    const spacing = ((beats[1] - beats[0]) / (V.t1 - V.t0)) * w;
    if (spacing >= 3) {
      for (const b of beats) {
        const bx = x(b);
        if (bx < 0 || bx > w) continue;
        vline(g, bx, L.SY, L.SY + L.SH, COL.beatSong);
        vline(g, bx, L.VY, L.VY + L.VH - 12, COL.beatVideo);
      }
    }
  }
  if (xv1 > xv0) {
    g.save();
    g.beginPath();
    g.rect(xv0, 0, xv1 - xv0, h);
    g.clip();
    drawTicks(g, w, V.t0 + off, V.t1 + off, h - 5, h, h - 2, '#6b7385');
    g.restore();
  }

  const fh = fadeHandles(w);
  if (fh) {
    g.fillStyle = COL.shade;
    if (fh.xs > 0) g.fillRect(0, L.SY, fh.xs, h - L.SY);
    if (fh.xe < w) g.fillRect(fh.xe, L.SY, w - fh.xe, h - L.SY);
    const top = L.VY + 7, bot = L.VY + L.VH - 12;
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.moveTo(fh.xs, top);
    g.lineTo(fh.xfi, top);
    g.lineTo(fh.xs, bot);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(fh.xe, top);
    g.lineTo(fh.xfo, top);
    g.lineTo(fh.xe, bot);
    g.closePath();
    g.fill();
    g.strokeStyle = COL.fade;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(fh.xs, bot);
    g.lineTo(fh.xfi, top);
    g.lineTo(fh.xfo, top);
    g.lineTo(fh.xe, bot);
    g.stroke();
    for (const xx of [fh.xs, fh.xe]) {
      vline(g, xx, L.SY, h, COL.accent, 2);
      g.fillStyle = COL.accent;
      g.fillRect(xx - 4, L.VY + L.VH / 2 - 12, 8, 24);
    }
    g.fillStyle = COL.fade;
    for (const xx of [fh.xfi, fh.xfo]) {
      g.beginPath();
      g.arc(xx, top, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawMarkers(g, w, L);

  g.fillStyle = COL.text;
  g.font = '11px system-ui, sans-serif';
  g.fillText(t('tl.song'), 5, L.SY + 13);
  g.fillText(t('tl.video'), 5, L.VY + 13);
  vline(g, x(currentSongTime()), 0, h, COL.play, 1.5);
}

function overviewRect(w: number) {
  const off = offsetS();
  return { x0: (-off / S.aDur) * w, x1: ((S.vDur - off) / S.aDur) * w };
}

function drawOverview() {
  const { g, w, h } = CV['#cvOverview'];
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, w, h);
  if (!S.p || !S.aDur) return;
  const X = (s: number) => (s / S.aDur) * w;
  const peaks = S.peaks;
  if (peaks) {
    const n = peaks.length, mid = h / 2;
    g.fillStyle = '#4d5569';
    for (let px = 0; px < w; px++) {
      const a = Math.floor((px / w) * n), b = Math.max(a + 1, Math.floor(((px + 1) / w) * n));
      let m = 0;
      for (let i = a; i < b; i++) if (peaks[i] > m) m = peaks[i];
      g.fillRect(px, mid - m * (mid - 2), 1, Math.max(1, 2 * m * (mid - 2)));
    }
  }
  if (S.vDur) {
    const off = offsetS();
    const r = overviewRect(w);
    g.fillStyle = 'rgba(79,179,255,0.16)';
    g.fillRect(r.x0, 0, r.x1 - r.x0, h);
    const tr = trimS();
    if (tr) {
      g.fillStyle = 'rgba(79,179,255,0.32)';
      g.fillRect(X(tr.start - off), 0, X(tr.end - tr.start), h);
    }
    g.strokeStyle = COL.accent;
    g.lineWidth = 1.5;
    g.strokeRect(r.x0 + 0.5, 0.5, r.x1 - r.x0 - 1, h - 1);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(X(V.t0) + 0.5, 3.5, Math.max(2, X(V.t1 - V.t0) - 1), h - 7);
  }
  drawTicks(g, w, 0, S.aDur, h - 4, h, h - 4, '#6b7385');
  vline(g, X(currentSongTime()), 0, h, COL.play, 1.5);
}

function updateScrollbar() {
  const span = V.t1 - V.t0;
  const r = scrollRange(span);
  const total = r.max - r.min;
  const th = $('#tlThumb');
  th.style.left = `${clamp((V.t0 - r.min) / total, 0, 1) * 100}%`;
  th.style.width = `${clamp(span / total, 0, 1) * 100}%`;
}

export function draw() {
  drawMain();
  drawOverview();
  updateScrollbar();
}

export function followPlayhead() {
  if (P.mode !== 'linked' || TL.dragging) return;
  const s = currentSongTime(), span = V.t1 - V.t0;
  // 再生中にユーザーが別の場所へスクロールしたときは引き戻さない
  if (s > V.t1 - span * 0.03 && s <= V.t1 + span * 0.05) viewSet(s - span * 0.1, s + span * 0.9);
}

// ---------- interaction ----------
type HitKind = 'seek' | 'video' | 'start' | 'end' | 'fadeIn' | 'fadeOut' | 'marker';

interface Drag {
  src: 'main' | 'pan' | 'overview' | 'scroll' | 'pinch';
  kind?: HitKind;
  lastX: number;
  acc: number;
  vref0: number;
  markerIdx: number;
  snapIdx?: number | null;
  moved?: boolean;
  lastResync?: number;
  pointerId: number;
  pinch?: { d0: number; mid0: number; t0: number; t1: number };
}

export const TL = { dragging: null as Drag | null };

const pointers = new Map<number, { x: number; y: number }>();
let tolScale = 1;

function canvasPos(e: { clientX: number; clientY: number }, id: string) {
  const r = CV[id].c.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}
type Pos = ReturnType<typeof canvasPos>;

function showDragInfo(text = '') {
  $('#dragInfo').textContent = text;
}

function offsetLabel(vrefDeltaMs: number) {
  const d = -vrefDeltaMs;
  return t('drag.offset', { pos: videoPosMs(), d: `${d >= 0 ? '+' : ''}${d}` });
}

// 同期の変更中は音の貼り直しを間引く
function dragResync(d: Drag) {
  const now = performance.now();
  if (P.mode === 'linked' && now - (d.lastResync || 0) > 200) {
    d.lastResync = now;
    P.resync();
  }
}

function mainHit(p: Pos): HitKind {
  const L = lanes(p.h);
  if (p.y < L.VY) return 'seek';
  const k = tolScale;
  const fh = fadeHandles(p.w);
  if (fh) {
    if (p.y < L.VY + 16 * k) {
      if (Math.abs(p.x - fh.xfi) <= 7 * k) return 'fadeIn';
      if (Math.abs(p.x - fh.xfo) <= 7 * k) return 'fadeOut';
    }
    if (Math.abs(p.x - fh.xs) <= 6 * k) return 'start';
    if (Math.abs(p.x - fh.xe) <= 6 * k) return 'end';
  }
  if (markerAt(p, 9 * k) >= 0) return 'marker';
  const tv = tvOf(p.x, p.w);
  return tv >= 0 && tv <= S.vDur ? 'video' : 'seek';
}

// つまみ付近なら index を返す。lineOnly のときは動画レーン内の線の近くでも当たりにする
function markerAt(p: Pos, yTol: number, lineOnly = false) {
  const L = lanes(p.h);
  const ky = markerKnobY(L);
  let best = -1, bestDx = 7 * tolScale;
  S.p!.markers.forEach((m, i) => {
    const dx = Math.abs(p.x - xvOf(m / 1000, p.w));
    const inY = lineOnly ? p.y >= L.SY && p.y <= L.VY + L.VH : Math.abs(p.y - ky) <= yTol;
    if (inY && dx < bestDx) {
      best = i;
      bestDx = dx;
    }
  });
  return best;
}

// 目印のどれかが拍線の SNAP_PX 以内に来たら、その拍にぴったり合う video_ref を返す
function snapToBeat(vref: number, w: number) {
  const ms = S.p!.markers;
  const beats = S.beats;
  if (!ms.length || !beats || !beats.length) return null;
  const pxPerS = w / (V.t1 - V.t0);
  const off = (vref - S.p!.audio_ref_ms) / 1000;
  let best: { px: number; idx: number; vref: number } | null = null;
  ms.forEach((m, i) => {
    const sPos = m / 1000 - off;
    let lo = 0, hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < sPos) lo = mid;
      else hi = mid;
    }
    for (const b of [beats[lo], beats[hi]]) {
      const px = Math.abs(b - sPos) * pxPerS;
      if (px <= SNAP_PX * tolScale && (!best || px < best.px)) best = { px, idx: i, vref: Math.round(S.p!.audio_ref_ms + (m / 1000 - b) * 1000) };
    }
  });
  return best as { px: number; idx: number; vref: number } | null;
}

const HIT_CURSOR: Record<HitKind, string> = {
  marker: 'ew-resize', video: 'grab', seek: 'crosshair', start: 'ew-resize', end: 'ew-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize',
};

function pinchState() {
  const ps = [...pointers.values()];
  const c = CV['#cvMain'];
  const r = c.c.getBoundingClientRect();
  const mid = (ps[0].x + ps[1].x) / 2 - r.left;
  return { d: Math.max(20, Math.abs(ps[0].x - ps[1].x)), mid, w: r.width };
}

let lastTap = { time: 0, x: 0, y: 0 };

function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // すでに離されたポインタでは失敗する
  }
}

function bindMain() {
  const c = $<HTMLCanvasElement>('#cvMain');
  c.addEventListener('pointermove', (e) => {
    if (TL.dragging || !S.p || e.pointerType !== 'mouse') return;
    tolScale = 1;
    c.style.cursor = HIT_CURSOR[mainHit(canvasPos(e, '#cvMain'))];
  });
  c.addEventListener('pointerdown', (e) => {
    if (!ready()) return;
    tolScale = e.pointerType === 'touch' ? 2.5 : 1;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    capture(c, e.pointerId);
    e.preventDefault();
    if (pointers.size === 2) {
      endDrag();
      const ps = pinchState();
      TL.dragging = { src: 'pinch', lastX: 0, acc: 0, vref0: 0, markerIdx: -1, pointerId: e.pointerId, pinch: { d0: ps.d, mid0: ps.mid, t0: V.t0, t1: V.t1 } };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1) {
      TL.dragging = { src: 'pan', lastX: e.clientX, acc: 0, vref0: 0, markerIdx: -1, pointerId: e.pointerId };
      c.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const p = canvasPos(e, '#cvMain');
    if (e.pointerType !== 'mouse') {
      const now = performance.now();
      const dbl = now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = { time: dbl ? 0 : now, x: e.clientX, y: e.clientY };
      if (dbl && tryAddMarker(p)) return;
    }
    const kind = mainHit(p);
    TL.dragging = {
      src: 'main', kind, lastX: p.x, acc: 0, vref0: S.p!.video_ref_ms,
      markerIdx: kind === 'marker' ? markerAt(p, 9 * tolScale) : -1, pointerId: e.pointerId,
    };
    if (kind === 'video') c.style.cursor = 'grabbing';
    mainMove(e);
  });
  c.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = TL.dragging;
    if (!d) return;
    if (d.src === 'pinch' && pointers.size >= 2) {
      const ps = pinchState();
      const pc = d.pinch!;
      const span0 = pc.t1 - pc.t0;
      const span = span0 * (pc.d0 / ps.d);
      const anchor = pc.t0 + (pc.mid0 / ps.w) * span0;
      const t0 = anchor - (ps.mid / ps.w) * span;
      viewSet(t0, t0 + span);
    } else if (d.pointerId === e.pointerId) {
      if (d.src === 'pan') {
        const dx = e.clientX - d.lastX;
        d.lastX = e.clientX;
        viewPan((-dx / CV['#cvMain'].w) * (V.t1 - V.t0));
      } else mainMove(e);
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const d = TL.dragging;
    if (!d) return;
    if (d.src === 'pinch') {
      if (pointers.size < 2) TL.dragging = null;
      return;
    }
    if (d.pointerId === e.pointerId) endDrag();
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('dblclick', (e) => {
    if (ready()) tryAddMarker(canvasPos(e, '#cvMain'));
  });
  c.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!ready()) return;
    const i = markerAt(canvasPos(e, '#cvMain'), 0, true);
    if (i >= 0) removeMarker(i);
  });
  c.addEventListener(
    'wheel',
    (e) => {
      if (!S.vDur) return;
      e.preventDefault();
      const p = canvasPos(e, '#cvMain');
      const span = V.t1 - V.t0;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dd = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY;
        viewPan(Math.sign(dd) * span * 0.12);
      } else {
        zoomAt(tOf(p.x, p.w), e.deltaY > 0 ? 1.25 : 0.8);
      }
    },
    { passive: false },
  );
}

function tryAddMarker(p: Pos) {
  const L = lanes(p.h);
  if (p.y < L.VY || mainHit(p) !== 'video') return false;
  addMarker(tvOf(p.x, p.w));
  return true;
}

function endDrag() {
  const d = TL.dragging;
  if (!d) return;
  TL.dragging = null;
  $('#cvMain').style.cursor = '';
  $('#tlThumb').classList.remove('drag');
  if (d.kind === 'video' && d.moved) changed({ sync: true });
  if (d.kind === 'marker') {
    S.p!.markers.sort((a, b) => a - b);
    changed();
  }
  setTimeout(() => showDragInfo(''), 1200);
}

function mainMove(e: PointerEvent) {
  const d = TL.dragging;
  if (!d || d.src !== 'main' || !S.p) return;
  const p = canvasPos(e, '#cvMain');
  const tv = tvOf(p.x, p.w);
  const tr = trimS()!;
  const durMs = Math.floor(S.vDur * 1000);
  const pr = S.p;
  switch (d.kind) {
    case 'seek':
      P.seek(tv);
      break;
    case 'start':
      setTrim(clamp(Math.round(tv * 1000), 0, pr.trim.end_ms! - MIN_TRIM_MS), pr.trim.end_ms!, { silent: true });
      showDragInfo(t('drag.start', { t: fmt(pr.trim.start_ms! / 1000) }));
      break;
    case 'end':
      setTrim(pr.trim.start_ms!, clamp(Math.round(tv * 1000), pr.trim.start_ms! + MIN_TRIM_MS, durMs), { silent: true });
      showDragInfo(t('drag.end', { t: fmt(pr.trim.end_ms! / 1000) }));
      break;
    case 'fadeIn': {
      const dur = pr.trim.end_ms! - pr.trim.start_ms!;
      pr.fade.in_ms = clamp(Math.round(((tv - tr.start) * 1000) / 10) * 10, 0, dur - pr.fade.out_ms);
      changed({ fade: true });
      showDragInfo(t('drag.fadeIn', { ms: pr.fade.in_ms }));
      break;
    }
    case 'fadeOut': {
      const dur = pr.trim.end_ms! - pr.trim.start_ms!;
      pr.fade.out_ms = clamp(Math.round(((tr.end - tv) * 1000) / 10) * 10, 0, dur - pr.fade.in_ms);
      changed({ fade: true });
      showDragInfo(t('drag.fadeOut', { ms: pr.fade.out_ms }));
      break;
    }
    case 'video': {
      const k = e.shiftKey ? 0.2 : 1;
      d.acc += ((p.x - d.lastX) / p.w) * (V.t1 - V.t0) * k;
      d.lastX = p.x;
      let vref = Math.round(d.vref0 - d.acc * 1000);
      const snap = e.altKey ? null : snapToBeat(vref, p.w);
      d.snapIdx = snap ? snap.idx : null;
      if (snap) vref = snap.vref;
      d.moved = d.moved || vref !== d.vref0;
      pr.video_ref_ms = vref;
      changed();
      dragResync(d);
      showDragInfo(offsetLabel(pr.video_ref_ms - d.vref0) + (snap ? '  ' + t('drag.snapped') : ''));
      break;
    }
    case 'marker': {
      if (d.markerIdx < 0) break;
      const ms = Math.round(clamp(tv, 0, S.vDur) * 1000);
      pr.markers[d.markerIdx] = ms;
      changed();
      showDragInfo(t('drag.marker', { t: fmt(ms / 1000) }));
      break;
    }
  }
}

// 全体図はシーク専用
function bindOverview() {
  const c = $<HTMLCanvasElement>('#cvOverview');
  const seek = (e: PointerEvent) => {
    const p = canvasPos(e, '#cvOverview');
    P.seek(clamp(p.x / p.w, 0, 1) * S.aDur + offsetS());
  };
  c.addEventListener('pointerdown', (e) => {
    if (!ready() || e.button !== 0) return;
    capture(c, e.pointerId);
    TL.dragging = { src: 'overview', lastX: 0, acc: 0, vref0: 0, markerIdx: -1, pointerId: e.pointerId };
    seek(e);
    e.preventDefault();
  });
  c.addEventListener('pointermove', (e) => {
    if (TL.dragging?.src === 'overview' && TL.dragging.pointerId === e.pointerId) seek(e);
  });
  const up = (e: PointerEvent) => {
    if (TL.dragging?.src === 'overview' && TL.dragging.pointerId === e.pointerId) TL.dragging = null;
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
}

function bindScrollbar() {
  const track = $('#tlScroll'), thumb = $('#tlThumb');
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    capture(thumb, e.pointerId);
    TL.dragging = { src: 'scroll', lastX: e.clientX, acc: 0, vref0: 0, markerIdx: -1, pointerId: e.pointerId };
    thumb.classList.add('drag');
    e.preventDefault();
    e.stopPropagation();
  });
  thumb.addEventListener('pointermove', (e) => {
    const d = TL.dragging;
    if (d?.src !== 'scroll' || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.lastX;
    d.lastX = e.clientX;
    const r = scrollRange(V.t1 - V.t0);
    viewPan((dx / track.clientWidth) * (r.max - r.min));
  });
  const up = (e: PointerEvent) => {
    if (TL.dragging?.src === 'scroll' && TL.dragging.pointerId === e.pointerId) endDrag();
  };
  thumb.addEventListener('pointerup', up);
  thumb.addEventListener('pointercancel', up);
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !S.vDur || e.target === thumb) return;
    const r = thumb.getBoundingClientRect();
    viewPan((e.clientX < r.left ? -1 : 1) * (V.t1 - V.t0) * 0.9);
  });
  track.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      viewPan(Math.sign(e.deltaY || e.deltaX) * (V.t1 - V.t0) * 0.12);
    },
    { passive: false },
  );
}

export function initTimeline() {
  ['#cvOverview', '#cvMain'].forEach(setupCanvas);
  resizeCanvases();
  bindMain();
  bindOverview();
  bindScrollbar();
}

