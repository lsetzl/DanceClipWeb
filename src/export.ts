import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type Rotation,
  type Target,
} from 'mediabunny';
import { t } from './i18n';

export interface ClipParams {
  video_ref_ms: number;
  audio_ref_ms: number;
  trim: { start_ms: number; end_ms: number };
  fade: { in_ms: number; out_ms: number };
  rotation: number | null;
}

export interface EncodeOptions {
  videoBitrate?: number;
  videoQuantizer?: number;
  audioBitrate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
}

export interface ExportProgress {
  fraction: number;
  frames: number;
}

export interface ExportResult {
  buffer: ArrayBuffer | null;
  frames: number;
  seconds: number;
  timings: Record<string, number>;
}

export function fadeGainAt(tOut: number, dur: number, finS: number, foutS: number): number {
  const a = finS > 0 ? tOut / finS : 1;
  const b = foutS > 0 ? (dur - tOut) / foutS : 1;
  return Math.min(1, Math.max(0, Math.min(a, b)));
}

export async function probeVideo(file: Blob) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(t('err.noVideoTrack'));
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      rotation: track.rotation,
      duration: await track.computeDuration(),
      canDecode: await track.canDecode(),
    };
  } finally {
    input.dispose();
  }
}

export async function decodeSong(file: Blob): Promise<AudioBuffer> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let sampleRate = 44100;
  try {
    sampleRate = (await input.getPrimaryAudioTrack())?.sampleRate ?? sampleRate;
  } catch {
    // 読めない形式でも decodeAudioData に任せる
  } finally {
    input.dispose();
  }
  const ctx = new OfflineAudioContext(2, 1, sampleRate);
  return ctx.decodeAudioData(await file.arrayBuffer());
}

export async function renderAudio(song: AudioBuffer, p: ClipParams): Promise<AudioBuffer> {
  const offsetS = (p.video_ref_ms - p.audio_ref_ms) / 1000;
  const startS = p.trim.start_ms / 1000;
  const durS = (p.trim.end_ms - p.trim.start_ms) / 1000;
  const finS = p.fade.in_ms / 1000;
  const foutS = p.fade.out_ms / 1000;
  const sr = song.sampleRate;
  const ctx = new OfflineAudioContext(song.numberOfChannels, Math.round(durS * sr), sr);

  const src = ctx.createBufferSource();
  src.buffer = song;
  const gain = ctx.createGain();
  src.connect(gain).connect(ctx.destination);

  const songPos = startS - offsetS;
  if (songPos >= 0) src.start(0, songPos);
  else src.start(-songPos, 0);

  const g = gain.gain;
  g.setValueAtTime(finS > 0 ? 0 : 1, 0);
  if (finS > 0) g.linearRampToValueAtTime(1, finS);
  if (foutS > 0) {
    g.setValueAtTime(1, Math.max(finS, durS - foutS));
    g.linearRampToValueAtTime(0, durS);
  }
  return ctx.startRendering();
}

function toCwRotation(ccw: number): Rotation {
  return (((360 - (ccw % 360)) % 360)) as Rotation;
}

export async function exportClip(
  videoFile: Blob,
  song: AudioBuffer,
  p: ClipParams,
  opts: EncodeOptions = {},
  onProgress?: (e: ExportProgress) => void,
  signal?: AbortSignal,
  target: Target = new BufferTarget(),
): Promise<ExportResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const startS = p.trim.start_ms / 1000;
  const endS = p.trim.end_ms / 1000;
  const durS = endS - startS;
  const finS = p.fade.in_ms / 1000;
  const foutS = p.fade.out_ms / 1000;

  const input = new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(t('err.noVideoTrack'));
  if (!(await track.canDecode())) throw new Error(t('err.cannotDecode', { codec: track.codec ?? '?' }));

  const audioPromise = renderAudio(song, p).then((b) => {
    timings.audioRender = performance.now() - t0;
    return b;
  });

  const w = track.codedWidth;
  const h = track.codedHeight;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const quality = opts.videoQuantizer != null
    ? new Quality({ quantizer: opts.videoQuantizer, bitrate: opts.videoBitrate })
    : new Quality({ bitrate: opts.videoBitrate ?? 14_000_000 });
  const videoSource = new VideoSampleSource({
    codec: 'avc',
    quality,
    keyFrameInterval: 2,
    hardwareAcceleration: opts.hardwareAcceleration ?? 'no-preference',
  });
  const audioSource = new AudioBufferSource({
    codec: 'aac',
    quality: new Quality({ bitrate: opts.audioBitrate ?? 192_000 }),
  });

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: target instanceof BufferTarget ? 'in-memory' : false }),
    target,
  });
  const rotation = p.rotation == null ? track.rotation : toCwRotation(p.rotation);
  output.addVideoTrack(videoSource, { rotation });
  output.addAudioTrack(audioSource);
  await output.start();

  const sink = new VideoSampleSink(track);
  let frames = 0;
  let prev: VideoSample | null = null;

  const emit = async (s: VideoSample, nextTs: number) => {
    const srcTs = s.timestamp;
    const tOut = frames === 0 ? 0 : srcTs - startS;
    const dur = Math.max(1e-3, nextTs - startS - tOut);
    const gain = fadeGainAt(srcTs - startS, durS, finS, foutS);
    let out: VideoSample;
    if (gain >= 1) {
      out = s;
    } else {
      s.draw(ctx, 0, 0, w, h);
      ctx.fillStyle = `rgba(0,0,0,${1 - gain})`;
      ctx.fillRect(0, 0, w, h);
      s.close();
      out = new VideoSample(canvas, { timestamp: 0 });
    }
    out.setRotation(0);
    out.setTimestamp(tOut);
    out.setDuration(dur);
    await videoSource.add(out);
    out.close();
    frames++;
    onProgress?.({ fraction: Math.min(1, Math.max(0, (srcTs - startS) / durS)), frames });
  };

  try {
    for await (const s of sink.samples(startS, endS)) {
      if (signal?.aborted) {
        s.close();
        throw new DOMException(t('err.cancelled'), 'AbortError');
      }
      if (s.timestamp < startS - 1e-6) {
        s.close();
        continue;
      }
      if (prev) await emit(prev, s.timestamp);
      prev = s;
    }
    if (prev) await emit(prev, endS);
    prev = null;
    timings.video = performance.now() - t0;

    const audio = await audioPromise;
    await audioSource.add(audio);
    await output.finalize();
  } catch (e) {
    prev?.close();
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    input.dispose();
  }
  timings.total = performance.now() - t0;
  const buffer = target instanceof BufferTarget ? target.buffer : null;
  return { buffer, frames, seconds: timings.total / 1000, timings };
}
