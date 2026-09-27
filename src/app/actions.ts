import { estimateBpm } from '../dsp/beat';
import { beatLockStable, LockError } from '../dsp/lock';
import { t } from '../i18n';
import { currentVideoTime, P } from './player';
import { barPhase, clamp, LOCK_HALF_S, MIN_TRIM_MS, offsetS, ready, S } from './state';
import { fileKey, saveProject } from './storage';
import { $, toast } from './ui';
import { updatePanels } from './view';

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let bpmTimer: ReturnType<typeof setTimeout> | undefined;

export function changed(what: { sync?: boolean; fade?: boolean } = {}) {
  S.dirty = true;
  if (what.sync && P.mode === 'linked') P.resync();
  if (what.fade && P.mode === 'linked') P.scheduleFade();
  if (what.sync) scheduleLocalBpm();
  updatePanels();
  scheduleSave();
}

export function scheduleSave() {
  if (!S.p || !S.videoFile || !S.audioFile) return;
  clearTimeout(saveTimer);
  $('#saveState').textContent = t('save.pending');
  saveTimer = setTimeout(saveNow, 700);
}

export async function saveNow() {
  if (!S.p || !S.videoFile || !S.audioFile) return;
  clearTimeout(saveTimer);
  try {
    await saveProject({
      key: fileKey(S.videoFile),
      p: structuredClone(S.p),
      updated: Date.now(),
      videoName: S.videoFile.name,
      audioName: S.audioFile.name,
      audioKey: fileKey(S.audioFile),
      videoHandle: S.videoHandle ?? undefined,
      audioHandle: S.audioHandle ?? undefined,
    });
    $('#saveState').textContent = t('save.saved', { time: new Date().toLocaleTimeString() });
  } catch (e) {
    $('#saveState').textContent = t('save.failed');
    toast(t('save.failedToast', { msg: e instanceof Error ? e.message : String(e) }), 'error');
  }
}

export function scheduleLocalBpm() {
  clearTimeout(bpmTimer);
  bpmTimer = setTimeout(() => {
    if (!S.p || !S.onset) return;
    try {
      S.localBpm = estimateBpm(S.onset, Math.max(0, currentVideoTime() - offsetS()));
      updatePanels();
    } catch {
      // 曲の端では推定できないことがある
    }
  }, 600);
}

export function clampFades() {
  const p = S.p!;
  const dur = p.trim.end_ms! - p.trim.start_ms!;
  let fin = Math.max(0, Math.round(p.fade.in_ms || 0));
  let fout = Math.max(0, Math.round(p.fade.out_ms || 0));
  if (fin + fout > dur) {
    const k = dur / (fin + fout);
    fin = Math.floor(fin * k);
    fout = Math.floor(fout * k);
    toast(t('trim.fadeShrunk'), 'warn');
  }
  p.fade.in_ms = fin;
  p.fade.out_ms = fout;
}

export function setTrim(startMs: number, endMs: number, { silent = false } = {}) {
  const durMs = Math.floor(S.vDur * 1000);
  startMs = Math.round(startMs);
  endMs = Math.round(endMs);
  if (!(startMs >= 0 && endMs <= durMs && endMs - startMs >= MIN_TRIM_MS)) {
    if (!silent) toast(t('trim.invalid', { min: MIN_TRIM_MS }), 'warn');
    return false;
  }
  S.p!.trim.start_ms = startMs;
  S.p!.trim.end_ms = endMs;
  clampFades();
  changed({ fade: true });
  return true;
}

export function normalizeTrim() {
  const durMs = Math.floor(S.vDur * 1000);
  const tr = S.p!.trim;
  if (tr.start_ms == null || tr.end_ms == null) {
    tr.start_ms = 0;
    tr.end_ms = durMs;
  } else if (!(tr.start_ms < tr.end_ms)) {
    toast(t('trim.broken', { s: tr.start_ms, e: tr.end_ms }), 'warn', 10000);
    tr.start_ms = 0;
    tr.end_ms = durMs;
  }
  tr.start_ms = clamp(tr.start_ms, 0, Math.max(0, durMs - MIN_TRIM_MS));
  tr.end_ms = clamp(tr.end_ms, tr.start_ms + MIN_TRIM_MS, durMs);
  clampFades();
}

// ms > 0 で動画を曲の後ろ側(タイムライン上で右)へずらす
export function nudge(ms: number) {
  if (!S.p) return;
  S.p.video_ref_ms = Math.round(S.p.video_ref_ms - ms);
  changed({ sync: true });
}

// 再生位置も同期も変えずにもう一度押したときは、前回と同じ範囲で探し直す(同じ答えになる)
let lastLock: { vAnchor: number; after: number; center: number } | null = null;

export function beatLock() {
  if (!ready() || !S.p) return;
  if (!S.motion || !S.onset) return toast(t('lock.notReady'), 'warn');
  const offMs = S.p.video_ref_ms - S.p.audio_ref_ms;
  const vMin = LOCK_HALF_S * 1000, vMax = Math.max(vMin, S.vDur * 1000 - LOCK_HALF_S * 1000);
  let vAnchor = clamp(Math.round(currentVideoTime() * 1000), vMin, vMax);
  vAnchor = clamp(vAnchor, offMs + vMin, offMs + S.aDur * 1000 - vMin);
  const center = lastLock && lastLock.vAnchor === vAnchor && lastLock.after === offMs ? lastLock.center : offMs;
  try {
    // BPM を推定する位置は 10 秒刻みに丸めて、少し動かしただけでは変わらないようにする
    const bpm = estimateBpm(S.onset, Math.round((vAnchor - center) / 10000) * 10);
    const r = beatLockStable(S.motion, S.onset, vAnchor, offMs, bpm, center);
    if (!r.applied) return toast(t('lock.lowCorr', { c: r.correlation.toFixed(3) }), 'warn');
    S.p.video_ref_ms += r.delta_ms;
    lastLock = { vAnchor, after: offMs + r.delta_ms, center };
    changed({ sync: true });
    const key = r.delta_ms === 0 ? 'lock.already' : r.delta_ms < 0 ? 'lock.movedRight' : 'lock.movedLeft';
    toast(t(key, { ms: Math.abs(r.delta_ms), c: r.correlation.toFixed(3) }));
  } catch (e) {
    toast(e instanceof LockError ? t('lock.edge') : t('lock.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error');
  }
}

export function shiftBarPhase(d: number) {
  if (!S.p || !S.beats) return;
  S.p.bar_phase = (((barPhase() + d) % 4) + 4) % 4;
  changed();
}

export function resetBarPhase() {
  if (!S.p) return;
  S.p.bar_phase = null;
  changed();
}

export function setIn() {
  if (S.p) setTrim(currentVideoTime() * 1000, S.p.trim.end_ms!);
}

export function setOut() {
  if (S.p) setTrim(S.p.trim.start_ms!, currentVideoTime() * 1000);
}

export function addMarker(tv: number) {
  if (!S.p || !S.vDur) return;
  const ms = Math.round(clamp(tv, 0, S.vDur) * 1000);
  if (S.p.markers.some((m) => Math.abs(m - ms) < 30)) return;
  S.p.markers.push(ms);
  S.p.markers.sort((a, b) => a - b);
  S.selMarkerMs = ms;
  changed();
}

export function removeMarker(i: number) {
  if (S.p!.markers[i] === S.selMarkerMs) S.selMarkerMs = null;
  S.p!.markers.splice(i, 1);
  changed();
}

export function selectMarker(i: number | null) {
  S.selMarkerMs = i == null ? null : S.p!.markers[i] ?? null;
  S.dirty = true;
}

export function deleteSelectedMarker() {
  if (!S.p) return;
  const i = S.selMarkerMs == null ? -1 : S.p.markers.indexOf(S.selMarkerMs);
  if (i < 0) return toast(t(S.p.markers.length ? 'marker.pickFirst' : 'marker.none'), 'warn');
  removeMarker(i);
}
