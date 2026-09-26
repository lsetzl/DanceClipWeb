import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { decodeSong, exportClip, probeVideo, type ClipParams, type EncodeOptions } from './export';
import { measureAacDelay } from './audioDelay';
import { applyI18n, define, lang, setLang, t, type Lang } from './i18n';
import './messages';

define(
  {
    'poc.title': 'DanceClip Web — 書き出しテスト',
    'poc.lead': '動画と曲はこの端末の中だけで処理します。どこにも送信しません。',
    'poc.files': 'ファイル',
    'poc.video': '動画',
    'poc.audio': '曲',
    'poc.settings': '設定',
    'poc.length': '書き出す長さ(秒、動画の先頭から)',
    'poc.bitrate': '映像ビットレート(Mbps)',
    'poc.advanced': '詳細: GUI版のプロジェクト JSON で指定',
    'poc.jsonHelp': '空欄なら上の長さを使います。入れた場合は同期・トリム・フェードをこの値にします。',
    'poc.run': '書き出す',
    'poc.cancel': 'キャンセル',
    'poc.pick': '動画と曲を選んでください',
    'poc.support': '対応状況: H.264 エンコード {v} / AAC エンコード {a}',
    'poc.start': '書き出し開始: {name}({w}x{h}、{codec}、{len}秒ぶん)',
    'poc.done': '完了: {sec}秒(実時間の {ratio} 倍速)、{frames} フレーム、{mb}MB',
    'poc.failed': '失敗: {msg}',
    'poc.diag': '診断',
    'poc.diagRun': '音声の遅延を測る',
  },
  {
    'poc.title': 'DanceClip Web — Export test',
    'poc.lead': 'Your video and song are processed only on this device. Nothing is uploaded.',
    'poc.files': 'Files',
    'poc.video': 'Video',
    'poc.audio': 'Song',
    'poc.settings': 'Settings',
    'poc.length': 'Length to export (seconds from the start of the video)',
    'poc.bitrate': 'Video bitrate (Mbps)',
    'poc.advanced': 'Advanced: use a project JSON from the desktop version',
    'poc.jsonHelp': 'If empty, the length above is used. Otherwise sync, trim and fades come from this JSON.',
    'poc.run': 'Export',
    'poc.cancel': 'Cancel',
    'poc.pick': 'Choose a video and a song',
    'poc.support': 'Support: H.264 encoding {v} / AAC encoding {a}',
    'poc.start': 'Exporting: {name} ({w}x{h}, {codec}, {len}s)',
    'poc.done': 'Done: {sec}s ({ratio}x real time), {frames} frames, {mb}MB',
    'poc.failed': 'Failed: {msg}',
    'poc.diag': 'Diagnostics',
    'poc.diagRun': 'Measure audio delay',
  },
);

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const log = (s: string) => ($('#log').textContent += s + '\n');

let abort: AbortController | null = null;

function params(videoDurationS: number): ClipParams {
  const raw = $<HTMLTextAreaElement>('#json').value.trim();
  if (raw) {
    const j = JSON.parse(raw);
    return { video_ref_ms: j.video_ref_ms, audio_ref_ms: j.audio_ref_ms, trim: j.trim, fade: j.fade, rotation: j.rotation ?? null };
  }
  const len = Math.min(Number($<HTMLInputElement>('#len').value) || 30, videoDurationS);
  return {
    video_ref_ms: 0,
    audio_ref_ms: 0,
    trim: { start_ms: 0, end_ms: Math.floor(len * 1000) },
    fade: { in_ms: 1000, out_ms: 1000 },
    rotation: null,
  };
}

async function run(video: Blob, audio: Blob, p: ClipParams, opts: EncodeOptions) {
  abort = new AbortController();
  $<HTMLButtonElement>('#cancel').disabled = false;
  const prog = $<HTMLProgressElement>('#prog');
  try {
    const t0 = performance.now();
    const song = await decodeSong(audio);
    const decodeMs = performance.now() - t0;
    const r = await exportClip(video, song, p, opts, (e) => (prog.value = e.fraction), abort.signal);
    const sec = (performance.now() - t0) / 1000;
    const len = (p.trim.end_ms - p.trim.start_ms) / 1000;
    log(t('poc.done', { sec: sec.toFixed(1), ratio: (len / sec).toFixed(1), frames: r.frames, mb: ((r.buffer?.byteLength ?? 0) / 1e6).toFixed(1) }));
    return { ...r, decodeMs, songLength: song.length, songRate: song.sampleRate };
  } finally {
    abort = null;
    $<HTMLButtonElement>('#cancel').disabled = true;
  }
}

$('#run').addEventListener('click', async () => {
  const v = $<HTMLInputElement>('#video').files?.[0];
  const a = $<HTMLInputElement>('#audio').files?.[0];
  if (!v || !a) return log(t('poc.pick'));
  try {
    const info = await probeVideo(v);
    const p = params(info.duration);
    log(t('poc.start', { name: v.name, w: info.width, h: info.height, codec: info.codec ?? '?', len: ((p.trim.end_ms - p.trim.start_ms) / 1000).toFixed(1) }));
    const r = await run(v, a, p, { videoBitrate: Number($<HTMLInputElement>('#vbr').value) * 1e6 });
    const url = URL.createObjectURL(new Blob([r.buffer!], { type: 'video/mp4' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = v.name.replace(/\.[^.]+$/, '') + '_clip.mp4';
    link.click();
  } catch (e) {
    log(t('poc.failed', { msg: e instanceof Error ? e.message : String(e) }));
  }
});
$('#cancel').addEventListener('click', () => abort?.abort());

$('#diag').addEventListener('click', async () => {
  try {
    for (const sr of [44100, 48000]) {
      const d = await measureAacDelay(sr);
      log(`AAC encoder delay @${sr}Hz: ${d} samples (${((d / sr) * 1000).toFixed(1)}ms)`);
    }
    const ctx = new AudioContext();
    await ctx.resume();
    await new Promise((r) => setTimeout(r, 500));
    const ts = ctx.getOutputTimestamp();
    const viaTs = ts.contextTime != null && ts.performanceTime != null ? (ctx.currentTime - ts.contextTime - (performance.now() - ts.performanceTime) / 1000) * 1000 : NaN;
    log(`AudioContext: sampleRate=${ctx.sampleRate} baseLatency=${(ctx.baseLatency * 1000).toFixed(1)}ms outputLatency=${((ctx.outputLatency ?? NaN) * 1000).toFixed(1)}ms outputTimestamp-lag=${viaTs.toFixed(1)}ms`);
    await ctx.close();
  } catch (e) {
    log(t('poc.failed', { msg: e instanceof Error ? e.message : String(e) }));
  }
});

const langSel = $<HTMLSelectElement>('#lang');
langSel.value = lang;
langSel.addEventListener('change', () => setLang(langSel.value as Lang));
applyI18n();

(async () => {
  const [v, a] = await Promise.all([
    canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 14e6 }).catch(() => false),
    canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100, bitrate: 192e3 }).catch(() => false),
  ]);
  log(t('poc.support', { v: v ? 'OK' : 'NG', a: a ? 'OK' : 'NG' }));
  log(navigator.userAgent);
})();

if (import.meta.env.DEV) {
  const fetchBlob = async (path: string) => {
    const r = await fetch('/__test/file?p=' + encodeURIComponent(path));
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.blob();
  };
  const pocRun = async (cfg: { video: string; audio: string; p: ClipParams; opts: EncodeOptions; out: string }) => {
    const [v, a] = await Promise.all([fetchBlob(cfg.video), fetchBlob(cfg.audio)]);
    const r = await run(v, a, cfg.p, cfg.opts);
    await fetch('/__test/save?name=' + encodeURIComponent(cfg.out), { method: 'POST', body: r.buffer! });
    return { frames: r.frames, seconds: r.seconds, timings: r.timings, decodeMs: r.decodeMs, bytes: r.buffer!.byteLength, songLength: r.songLength, songRate: r.songRate };
  };
  const pocAuto = async (name: string) => {
    const jobs = await (await fetch('/__test/jobs?name=' + encodeURIComponent(name))).json();
    const res: Record<string, unknown> = { ua: navigator.userAgent };
    for (const j of jobs) {
      try {
        res[j.out] = await pocRun(j);
      } catch (e) {
        res[j.out] = 'error: ' + e;
      }
      await fetch(`/__test/save?name=result_${name}.json`, { method: 'POST', body: JSON.stringify(res, null, 1) });
    }
    log('AUTO DONE');
  };
  Object.assign(window, { pocRun, pocAuto });
  const auto = new URLSearchParams(location.search).get('auto');
  if (auto) pocAuto(auto);
}
