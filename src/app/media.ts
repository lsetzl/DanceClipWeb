import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { analyzeAudio, analyzeMotion } from '../analysis/client';
import { t } from '../i18n';
import { changed, normalizeTrim, scheduleLocalBpm } from './actions';
import { P, video } from './player';
import { newProject, normalizeProject, PEAK_HZ, S, type Project, type VideoInfo } from './state';
import { fileKey, loadProject, recentProjects, type SavedProject } from './storage';
import { viewFit } from './timeline';
import { $, fmt, loading, modal, percentile, status, toast } from './ui';
import { layoutVideo, updatePanels, updateSourceInfo } from './view';

type Kind = 'video' | 'audio' | 'project';

const ACCEPT: Record<Kind, Record<string, string[]>> = {
  video: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'] },
  audio: { 'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus'] },
  project: { 'application/json': ['.json'] },
};

export function classify(f: File): Kind | null {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json') return 'project';
  if (f.type.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
  if (f.type.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
  return null;
}

export interface Picked { file: File; handle: FileSystemFileHandle | null }

export async function pickFile(kind: Kind): Promise<Picked | null> {
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> };
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: [{ description: t(`pick.${kind}`), accept: ACCEPT[kind] }], excludeAcceptAllOption: false });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'project' ? '.json,application/json' : Object.values(ACCEPT[kind]).flat().concat(Object.keys(ACCEPT[kind])).join(',');
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function fileFromHandle(handle: FileSystemFileHandle | undefined): Promise<File | null> {
  if (!handle) return null;
  try {
    const h = handle as FileSystemFileHandle & {
      queryPermission?: (o: object) => Promise<PermissionState>;
      requestPermission?: (o: object) => Promise<PermissionState>;
    };
    let perm = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (perm !== 'granted') perm = (await h.requestPermission?.({ mode: 'read' })) ?? 'denied';
    return perm === 'granted' ? await handle.getFile() : null;
  } catch {
    return null;
  }
}

async function probe(file: File): Promise<VideoInfo & { canDecode: boolean }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(t('err.noVideoTrack'));
    const [duration, stats, canDecode] = await Promise.all([
      track.computeDuration(),
      track.computePacketStats(120).catch(() => null),
      track.canDecode(),
    ]);
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      rotation: track.rotation,
      duration,
      fps: stats?.averagePacketRate || 30,
      canDecode,
    };
  } finally {
    input.dispose();
  }
}

export function hideWelcome() {
  $('#welcome').classList.add('hidden');
  layoutVideo();
}

async function loadVideo(file: File, handle: FileSystemFileHandle | null, { keepProject = false } = {}) {
  loading(t('load.video'));
  try {
    const info = await probe(file);
    P.pause();
    const url = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(t('err.videoPlay', { codec: info.codec ?? '?' })));
      video.src = url;
      video.defaultPlaybackRate = video.playbackRate = P.rate;
    });
    if (S.videoUrl) URL.revokeObjectURL(S.videoUrl);
    S.videoUrl = url;
    S.videoFile = file;
    S.videoHandle = handle;
    S.vInfo = info;
    S.fps = info.fps;
    S.vDur = video.duration || info.duration;
    S.motion = null;
    viewFit();
    if (!keepProject || !S.p) {
      const prev = S.p;
      S.p = newProject(file.name, prev ? prev.audio : '');
      if (prev?.audio) S.p.audio_ref_ms = prev.audio_ref_ms;
    }
    S.p.video = file.name;
    normalizeTrim();
    updateSourceInfo();
    layoutVideo();
    loadVideoSignals(file);
    if (!info.canDecode) toast(t('warn.cannotExport', { codec: info.codec ?? '?' }), 'warn', 10000);
    if (info.rotation) toast(t('warn.rotTag', { deg: (360 - info.rotation) % 360 }), 'warn', 7000);
  } finally {
    loading(null);
  }
}

async function loadAudio(file: File, handle: FileSystemFileHandle | null, { keepProject = false } = {}) {
  loading(t('load.audio'));
  try {
    P.pause();
    const ctx = P.ensureCtx();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    S.audioFile = file;
    S.audioHandle = handle;
    S.buffer = buffer;
    S.aDur = buffer.duration;
    S.peaks = computePeaks(buffer);
    S.onset = null;
    S.beats = null;
    S.bpm = null;
    S.localBpm = null;
    if (!S.p) S.p = newProject('', file.name);
    if (!keepProject) S.p.audio_ref_ms = 0;
    S.p.audio = file.name;
    updateSourceInfo();
    loadAudioSignals(file);
  } catch (e) {
    throw new Error(t('err.audioDecode', { msg: e instanceof Error ? e.message : String(e) }));
  } finally {
    loading(null);
  }
}

// PEAK_HZ ごとの最大振幅。ズームしても波形が潰れない解像度で1回だけ作る
function computePeaks(buffer: AudioBuffer) {
  const ch: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) ch.push(buffer.getChannelData(c));
  const len = buffer.length;
  const step = buffer.sampleRate / PEAK_HZ;
  const n = Math.ceil(len / step);
  const out = new Float32Array(n);
  for (const d of ch) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), b = Math.min(len, Math.floor((i + 1) * step));
      let m = out[i];
      for (let j = a; j < b; j++) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
      out[i] = m;
    }
  }
  const mx = percentile(out, 0.995);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] / mx);
  return out;
}

async function loadVideoSignals(file: File) {
  status(t('status.motion', { p: 0 }));
  try {
    const m = await analyzeMotion(file, (f) => status(t('status.motion', { p: Math.round(f * 100) })));
    if (S.videoFile !== file) return;
    // 30fps を 50Hz で取り出すと重複フレームの差分が 0 になりギザギザになるので、表示用に隣と max を取る
    S.motion = Float32Array.from(m, (v, i) => Math.max(v, m[i + 1] ?? v));
    S.motionScale = percentile(S.motion, 0.99);
    S.dirty = true;
    status('');
  } catch (e) {
    status('');
    toast(t('err.motion', { msg: e instanceof Error ? e.message : String(e) }), 'error');
  }
}

async function loadAudioSignals(file: File) {
  status(t('status.beats', { p: 0 }));
  try {
    const r = await analyzeAudio(file, (f) => status(t('status.beats', { p: Math.round(f * 100) })));
    if (S.audioFile !== file) return;
    S.onset = r.onset;
    S.beats = r.beats;
    S.bpm = r.bpm;
    scheduleLocalBpm();
    S.dirty = true;
    updatePanels();
    status('');
  } catch (e) {
    status('');
    toast(t('err.beats', { msg: e instanceof Error ? e.message : String(e) }), 'error');
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function applyProject(p: Project, v: Picked, a: Picked | null) {
  P.pause();
  S.p = p;
  await loadVideo(v.file, v.handle, { keepProject: true });
  if (a) await loadAudio(a.file, a.handle, { keepProject: true });
  layoutVideo();
  hideWelcome();
  viewFit();
  P.seek(p.trim.start_ms != null ? p.trim.start_ms / 1000 : 0);
  changed();
}

// 保存済みの曲を探す: 今読み込んでいる曲 → 保存したハンドル → ユーザーに選んでもらう
async function resolveAudio(saved: { audioName: string; audioKey: string | null; audioHandle?: FileSystemFileHandle }): Promise<Picked | null> {
  if (S.audioFile && saved.audioKey && fileKey(S.audioFile) === saved.audioKey) return { file: S.audioFile, handle: S.audioHandle };
  const f = await fileFromHandle(saved.audioHandle);
  if (f) return { file: f, handle: saved.audioHandle ?? null };
  if (!saved.audioName) return null;
  const ok = await modal(t('proj.pickAudio', { name: saved.audioName }), [[t('btn.later'), false], [t('btn.pick'), true, 'accent']]);
  if (!ok) return null;
  const a = await pickFile('audio');
  if (a && a.file.name !== saved.audioName) toast(t('proj.audioDiffers', { name: saved.audioName }), 'warn', 8000);
  return a;
}

async function openSaved(saved: SavedProject, v: Picked) {
  const a = await resolveAudio(saved);
  await applyProject(normalizeProject(saved.p), v, a);
  toast(t('proj.resumed', { name: saved.videoName }), 'ok');
}

export async function openVideo(v: Picked | null) {
  if (!v) return;
  try {
    const saved = await loadProject(fileKey(v.file)).catch(() => undefined);
    if (saved) {
      const ans = await modal(t('proj.foundSaved', { name: v.file.name, time: new Date(saved.updated).toLocaleString() }), [
        [t('btn.startNew'), 'new'],
        [t('btn.resume'), 'open', 'accent'],
      ]);
      if (ans === 'open') return await openSaved(saved, v);
    }
    await loadVideo(v.file, v.handle);
    hideWelcome();
    changed();
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function openAudio(a: Picked | null) {
  if (!a) return;
  try {
    await loadAudio(a.file, a.handle);
    viewFit();
    hideWelcome();
    changed();
    if (S.videoFile) toast(t('hint.afterAudio'), '', 8000);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function openRecent(saved: SavedProject) {
  try {
    let f = await fileFromHandle(saved.videoHandle);
    let handle = f ? saved.videoHandle ?? null : null;
    if (!f) {
      const ok = await modal(t('proj.pickVideo', { name: saved.videoName }), [[t('btn.cancel'), false], [t('btn.pick'), true, 'accent']]);
      if (!ok) return;
      const v = await pickFile('video');
      if (!v) return;
      if (fileKey(v.file) !== saved.key) {
        const go = await modal(t('proj.videoDiffers', { name: saved.videoName, picked: v.file.name }), [[t('btn.cancel'), false], [t('btn.useAnyway'), true]]);
        if (!go) return;
      }
      f = v.file;
      handle = v.handle;
    }
    await openSaved(saved, { file: f, handle });
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export async function importProjectJson(file: File) {
  let p: Project;
  try {
    p = normalizeProject(JSON.parse(await file.text()));
    if (typeof p.video_ref_ms !== 'number' || typeof p.audio_ref_ms !== 'number') throw new Error('invalid');
  } catch {
    return toast(t('proj.badJson'), 'error');
  }
  const ok = await modal(t('proj.importPick', { video: p.video || '?', audio: p.audio || '?' }), [[t('btn.cancel'), false], [t('btn.pick'), true, 'accent']]);
  if (!ok) return;
  const v = await pickFile('video');
  if (!v) return;
  const a = await resolveAudio({ audioName: p.audio, audioKey: null });
  try {
    await applyProject(p, v, a);
    toast(t('proj.imported'), 'ok');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export function exportProjectJson() {
  if (!S.p) return;
  const blob = new Blob([JSON.stringify({ ...S.p, updated: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.videoFile?.name.replace(/\.[^.]+$/, '') || 'project') + '.danceclip.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export async function handleDrop(items: Picked[]) {
  const by = (k: Kind) => items.find((i) => classify(i.file) === k);
  const proj = by('project');
  if (proj) return importProjectJson(proj.file);
  const v = by('video'), a = by('audio');
  if (!v && !a) return toast(t('drop.unknown'), 'warn');
  if (v) await openVideo(v);
  if (a) await openAudio(a);
}

export async function renderRecent() {
  let items: SavedProject[] = [];
  try {
    items = await recentProjects();
  } catch {
    // IndexedDB が使えない
  }
  const fill = (box: HTMLElement) => {
    box.innerHTML = '';
    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'item dim';
      d.textContent = t('recent.none');
      box.appendChild(d);
      return;
    }
    for (const r of items) {
      const d = document.createElement('div');
      d.className = 'item';
      const a = document.createElement('div');
      a.textContent = `${r.videoName}  ♪ ${r.audioName || '-'}`;
      const b = document.createElement('div');
      b.className = 't';
      const trim = r.p.trim.start_ms != null && r.p.trim.end_ms != null ? fmt((r.p.trim.end_ms - r.p.trim.start_ms) / 1000) : '';
      b.textContent = `${new Date(r.updated).toLocaleString()}  ${trim}`;
      d.append(a, b);
      d.onclick = () => {
        $('#recentMenu').classList.remove('open');
        openRecent(r);
      };
      box.appendChild(d);
    }
  };
  fill($('#recentMenu'));
  fill($('#welcomeRecent'));
}

