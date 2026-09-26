export const MIN_TRIM_MS = 500;
export const DRIFT_LIMIT_S = 0.035;
export const PEAK_HZ = 500;
export const LOCK_HALF_S = 4;
export const SNAP_PX = 8;
export const RATES = [1, 0.75, 0.5, 0.25];
export const DEFAULT_VIDEO_BITRATE = 14_000_000;

// GUI版のプロジェクト JSON と同じ形。video / audio はファイル名(GUI版ではフルパス)
export interface Project {
  version: number;
  video: string;
  audio: string;
  video_ref_ms: number;
  audio_ref_ms: number;
  trim: { start_ms: number | null; end_ms: number | null };
  fade: { in_ms: number; out_ms: number };
  rotation: number | null;
  output: string | null;
  markers: number[];
}

export interface TrimmedProject extends Project {
  trim: { start_ms: number; end_ms: number };
}

export interface VideoInfo {
  width: number;
  height: number;
  codec: string | null;
  rotation: number;
  duration: number;
  fps: number;
}

export const S = {
  p: null as Project | null,
  videoFile: null as File | null,
  audioFile: null as File | null,
  videoHandle: null as FileSystemFileHandle | null,
  audioHandle: null as FileSystemFileHandle | null,
  videoUrl: null as string | null,
  vInfo: null as VideoInfo | null,
  fps: 30,
  vDur: 0,
  aDur: 0,
  buffer: null as AudioBuffer | null,
  peaks: null as Float32Array | null,
  hz: 50,
  motion: null as Float32Array | null,
  motionScale: 1,
  onset: null as Float32Array | null,
  beats: null as number[] | null,
  bpm: null as number | null,
  localBpm: null as number | null,
  loop: false,
  fadePreview: true,
  rendering: false,
  selMarkerMs: null as number | null,
  dirty: true,
};

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export const offsetS = () => (S.p ? (S.p.video_ref_ms - S.p.audio_ref_ms) / 1000 : 0);

export const trimS = () =>
  S.p && S.p.trim.start_ms != null && S.p.trim.end_ms != null
    ? { start: S.p.trim.start_ms / 1000, end: S.p.trim.end_ms / 1000 }
    : null;

export const beatMs = () => Math.round(60000 / (S.localBpm || S.bpm || 120));

export const ready = () => !!(S.p && S.videoFile && S.audioFile && S.vDur > 0 && S.buffer);

// 動画の頭が曲の何 ms にあるか(= -offset)
export const videoPosMs = () => (S.p ? S.p.audio_ref_ms - S.p.video_ref_ms : 0);

export function fadeGain(tv: number) {
  const t = trimS();
  if (!S.fadePreview || !t || !S.p || tv < t.start || tv > t.end) return 1;
  const fin = S.p.fade.in_ms / 1000, fout = S.p.fade.out_ms / 1000;
  const a = fin > 0 ? (tv - t.start) / fin : 1;
  const b = fout > 0 ? (t.end - tv) / fout : 1;
  return clamp(Math.min(a, b, 1), 0, 1);
}

export function newProject(video = '', audio = ''): Project {
  return {
    version: 1,
    video,
    audio,
    video_ref_ms: 0,
    audio_ref_ms: 0,
    trim: { start_ms: null, end_ms: null },
    fade: { in_ms: 1000, out_ms: 1000 },
    rotation: null,
    output: null,
    markers: [],
  };
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

// GUI版の JSON(フルパス)も受け付ける
export function normalizeProject(raw: Partial<Project>): Project {
  const base = newProject();
  return {
    ...base,
    ...raw,
    video: baseName(raw.video ?? ''),
    audio: baseName(raw.audio ?? ''),
    trim: { ...base.trim, ...(raw.trim ?? {}) },
    fade: { ...base.fade, ...(raw.fade ?? {}) },
    markers: Array.isArray(raw.markers) ? raw.markers.slice() : [],
    output: null,
  };
}
