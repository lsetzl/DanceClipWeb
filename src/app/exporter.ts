import { BufferTarget, canEncodeAudio, canEncodeVideo, StreamTarget, type Target } from 'mediabunny';
import { decodeSong, exportClip } from '../export';
import { t } from '../i18n';
import { saveNow } from './actions';
import { P } from './player';
import { DEFAULT_VIDEO_BITRATE, ready, S, type TrimmedProject } from './state';
import { $, fmt, toast } from './ui';

let abort: AbortController | null = null;
let lastUrl: string | null = null;

export async function checkSupport(): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return t('export.noWebCodecs');
  const [v, a] = await Promise.all([
    canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: DEFAULT_VIDEO_BITRATE }).catch(() => false),
    canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100, bitrate: 192e3 }).catch(() => false),
  ]);
  if (!v) return t('export.noH264');
  if (!a) return t('export.noAac');
  return null;
}

type Sink = { target: Target; finish: () => Promise<void>; fail: () => Promise<void> };

// 保存ダイアログ(PC の Chrome / Edge)→ OPFS に書いてからダウンロード(Android)→ メモリ の順に使う
async function openSink(name: string): Promise<Sink | null> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
    const writable = await handle.createWritable();
    return {
      target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
      finish: async () => {
        $('#renderDoneText').textContent = t('export.savedTo', { name: handle.name });
      },
      fail: async () => {},
    };
  }
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle('export.mp4', { create: true });
    const writable = await (fh as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    return {
      target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
      finish: async () => offerDownload(await fh.getFile(), name),
      fail: async () => {
        await dir.removeEntry('export.mp4').catch(() => {});
      },
    };
  } catch {
    const target = new BufferTarget();
    return {
      target,
      finish: async () => offerDownload(new Blob([target.buffer!], { type: 'video/mp4' }), name),
      fail: async () => {},
    };
  }
}

function offerDownload(blob: Blob, name: string) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  const a = $<HTMLAnchorElement>('#btnDownload');
  a.href = lastUrl;
  a.download = name;
  a.classList.remove('hidden');
  $('#renderDoneText').textContent = t('export.ready', { mb: (blob.size / 1e6).toFixed(1) });
  a.click();
}

export async function startRender() {
  if (!ready() || S.rendering || !S.p || !S.videoFile || !S.audioFile) return;
  const p = S.p;
  if (p.trim.start_ms == null || p.trim.end_ms == null || !(p.trim.start_ms < p.trim.end_ms)) return toast(t('trim.invalid', { min: 500 }), 'error');
  S.rendering = true;
  let sink: Sink | null = null;
  try {
    const unsupported = await checkSupport();
    if (unsupported) toast(unsupported, 'error', 12000);
    else {
      P.pause();
      sink = await openSink(S.videoFile.name.replace(/\.[^.]+$/, '') + '_clip.mp4');
    }
  } catch (e) {
    toast(t('export.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error', 15000);
  }
  if (!sink) {
    S.rendering = false;
    return;
  }

  abort = new AbortController();
  $('#renderBox').classList.remove('hidden');
  $('#renderDone').classList.add('hidden');
  $('#btnDownload').classList.add('hidden');
  $('#renderBar').style.width = '0%';
  $('#renderText').textContent = t('export.preparing');
  $<HTMLButtonElement>('#btnRender').disabled = true;
  saveNow();
  const t0 = performance.now();
  const lenS = (p.trim.end_ms - p.trim.start_ms) / 1000;
  try {
    const song = await decodeSong(S.audioFile);
    await exportClip(
      S.videoFile,
      song,
      structuredClone(p) as TrimmedProject,
      { videoBitrate: DEFAULT_VIDEO_BITRATE },
      (e) => {
        const el = (performance.now() - t0) / 1000;
        $('#renderBar').style.width = `${(e.fraction * 100).toFixed(1)}%`;
        $('#renderText').textContent = `${(e.fraction * 100).toFixed(1)}%  ${((e.fraction * lenS) / Math.max(el, 0.01)).toFixed(1)}x`;
      },
      abort.signal,
      sink.target,
    );
    await sink.finish();
    $('#renderDone').classList.remove('hidden');
    toast(t('export.done', { sec: ((performance.now() - t0) / 1000).toFixed(1), len: fmt(lenS) }), 'ok', 6000);
  } catch (e) {
    await sink.fail();
    if (e instanceof DOMException && e.name === 'AbortError') toast(t('export.cancelled'), 'warn');
    else toast(t('export.failed', { msg: e instanceof Error ? e.message : String(e) }), 'error', 15000);
  } finally {
    S.rendering = false;
    abort = null;
    $<HTMLButtonElement>('#btnRender').disabled = false;
    $('#renderBox').classList.add('hidden');
  }
}

export function cancelRender() {
  abort?.abort();
}

document.addEventListener('visibilitychange', () => {
  if (S.rendering && document.hidden) toast(t('export.keepVisible'), 'warn', 10000);
});
