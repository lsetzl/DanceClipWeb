import { t } from '../i18n';
import { clamp, DRIFT_LIMIT_S, fadeGain, offsetS, ready, S, trimS } from './state';
import { ensureVisible } from './timeline';
import { $, median, toast } from './ui';
import { updateOverlay, updateTransport } from './view';

export const video = document.querySelector('#video') as HTMLVideoElement;

interface SongMap { ctx0: number; song0: number; rate: number }

export const P = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  fader: null as GainNode | null,
  src: null as AudioBufferSourceNode | null,
  srcGain: null as GainNode | null,
  map: null as SongMap | null,
  mode: 'stop' as 'stop' | 'linked',
  needStart: false,
  seeking: false,
  drifts: [] as number[],
  lastResync: 0,
  drift: null as number | null,
  resyncCount: 0,
  frameHandle: null as number | null,
  rate: 1,

  ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = +$<HTMLInputElement>('#volume').value;
      this.master.connect(this.ctx.destination);
      this.fader = this.ctx.createGain();
      this.fader.connect(this.master);
    }
    return this.ctx;
  },

  // perf 時刻 perfMs にスピーカーから出ている音の AudioContext 時刻
  heardCtxAt(perfMs: number) {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime! > 0 && ts.contextTime! > 0) {
      return ts.contextTime! + (perfMs - ts.performanceTime!) / 1000;
    }
    const lat = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime - lat + (perfMs - performance.now()) / 1000;
  },

  songAtCtx(w: number) {
    return this.map ? this.map.song0 + (w - this.map.ctx0) * this.map.rate : null;
  },
  ctxAtVideo(tv: number) {
    return this.map!.ctx0 + (tv - offsetS() - this.map!.song0) / this.map!.rate;
  },

  stopSource() {
    if (!this.src) return;
    const now = this.ctx!.currentTime;
    const g = this.srcGain!.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.008);
      this.src.stop(now + 0.012);
    } catch {
      // 開始前に止めた場合
    }
    this.src.onended = null;
    this.src = null;
    this.srcGain = null;
  },

  startSourceAt(when: number, songPos: number) {
    const rate = this.rate;
    this.map = { ctx0: when, song0: songPos, rate };
    if (!S.buffer) return;
    let at = when, off = songPos;
    if (off < 0) {
      at = when - off / rate;
      off = 0;
    }
    if (off >= S.buffer.duration) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = S.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.004);
    src.connect(g);
    g.connect(this.fader!);
    src.start(at, off);
    this.src = src;
    this.srcGain = g;
  },

  scheduleFade() {
    if (!this.fader || !this.ctx) return;
    const g = this.fader.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(0);
    const tr = trimS();
    if (this.mode !== 'linked' || !this.map || !S.fadePreview || !tr || !S.p) {
      g.setValueAtTime(1, now);
      return;
    }
    const off = offsetS();
    const tvNow = this.map.song0 + off + (now - this.map.ctx0) * this.map.rate;
    g.setValueAtTime(fadeGain(tvNow), now);
    const fin = S.p.fade.in_ms / 1000, fout = S.p.fade.out_ms / 1000;
    const pts: [number, 'set' | 'ramp', number][] = [
      [tr.start, 'set', 0],
      [tr.start + fin, 'ramp', 1],
      [tr.end - fout, 'set', 1],
      [tr.end, 'ramp', 0],
      [tr.end + 0.001, 'set', 1],
    ];
    for (const [tv, kind, v] of pts.filter(([tv]) => tv > tvNow).sort((a, b) => a[0] - b[0])) {
      const w = this.ctxAtVideo(tv);
      if (kind === 'set') g.setValueAtTime(v, w);
      else g.linearRampToValueAtTime(v, w);
    }
  },

  resync() {
    if (this.mode !== 'linked') return;
    this.stopSource();
    this.needStart = true;
  },

  watchFrames() {
    if (this.frameHandle != null) video.cancelVideoFrameCallback(this.frameHandle);
    this.frameHandle = video.requestVideoFrameCallback((now, meta) => this.onFrame(now, meta));
  },

  onFrame(now: number, meta: VideoFrameCallbackMetadata) {
    this.frameHandle = null;
    if (this.mode !== 'linked') return;
    this.watchFrames();
    const M = meta.mediaTime;
    updateOverlay(M);
    if (this.seeking || video.paused) return;
    const tr = trimS();
    if (S.loop && tr && M >= tr.end - 0.5 / S.fps) {
      this.seek(tr.start);
      return;
    }
    const off = offsetS();
    const Pd = meta.expectedDisplayTime;
    if (this.needStart) {
      this.needStart = false;
      const when = this.ctx!.currentTime + 0.05;
      const heard = this.heardCtxAt(Pd);
      const tv = M + (when - heard) * video.playbackRate;
      this.startSourceAt(when, tv - off);
      this.scheduleFade();
      this.drifts = [];
      this.lastResync = now;
      return;
    }
    if (!this.map || now - this.lastResync < 300) return;
    const drift = this.songAtCtx(this.heardCtxAt(Pd))! - (M - off);
    this.drifts.push(drift);
    if (this.drifts.length > 15) this.drifts.shift();
    if (this.drifts.length >= 8) {
      this.drift = median(this.drifts);
      if (Math.abs(this.drift) > DRIFT_LIMIT_S && now - this.lastResync > 1000) {
        this.resyncCount++;
        this.resync();
      }
    }
  },

  async play() {
    if (!ready()) return;
    this.ensureCtx();
    await this.ctx!.resume();
    const tr = trimS();
    if (video.ended || video.currentTime >= S.vDur - 0.05) video.currentTime = S.loop && tr ? tr.start : 0;
    if (S.loop && tr && (video.currentTime < tr.start || video.currentTime >= tr.end - 0.05)) video.currentTime = tr.start;
    this.mode = 'linked';
    this.needStart = true;
    this.drift = null;
    this.watchFrames();
    try {
      await video.play();
    } catch (e) {
      this.pause();
      toast(t('err.play', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
    updateTransport();
  },

  pause() {
    this.mode = 'stop';
    video.pause();
    this.stopSource();
    this.map = null;
    if (this.fader) this.fader.gain.cancelScheduledValues(0);
    updateTransport();
  },

  toggle() {
    if (this.mode === 'stop') this.play();
    else this.pause();
  },

  setRate(rate: number) {
    this.rate = rate;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    this.resync();
    const sel = $<HTMLSelectElement>('#selRate');
    if (sel.value !== String(rate)) sel.value = String(rate);
  },

  seek(tv: number) {
    if (!S.vDur) return;
    tv = clamp(tv, 0, S.vDur - 0.001);
    if (this.mode === 'linked') {
      this.stopSource();
      this.needStart = true;
    }
    this.seeking = true;
    video.currentTime = tv;
    ensureVisible(tv - offsetS());
    S.dirty = true;
  },
};

video.addEventListener('seeked', () => {
  P.seeking = false;
  updateOverlay(video.currentTime);
  S.dirty = true;
  if (P.mode === 'linked' && video.paused) video.play().catch(() => {});
});
video.addEventListener('seeking', () => (P.seeking = true));
video.addEventListener('ended', () => {
  if (P.mode === 'linked') P.pause();
});

export const currentVideoTime = () => video.currentTime || 0;
export const currentSongTime = () => currentVideoTime() - offsetS();
