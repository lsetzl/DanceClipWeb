import { cacheGet, cacheKey, cachePut } from '../app/storage';
import { decodeSong } from '../export';
import type { WorkerRequest, WorkerResponse } from './worker';
import AnalysisWorker from './worker?worker';

const ANALYSIS_VERSION = 2;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

function getWorker() {
  if (!worker) {
    worker = new AnalysisWorker();
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') return p.progress?.(m.fraction);
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m);
    };
  }
  return worker;
}

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function request(req: Req, transfer: Transferable[], progress?: (f: number) => void): { id: number; done: Promise<WorkerResponse> } {
  const id = nextId++;
  const done = new Promise<WorkerResponse>((resolve, reject) => pending.set(id, { resolve, reject, progress }));
  getWorker().postMessage({ ...req, id }, transfer);
  return { id, done };
}

export function cancel(id: number) {
  getWorker().postMessage({ id: 0, type: 'cancel', target: id });
  const p = pending.get(id);
  pending.delete(id);
  p?.reject(new DOMException('aborted', 'AbortError'));
}

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const k = `v${ANALYSIS_VERSION}|${key}`;
  try {
    const hit = await cacheGet<T>(k);
    if (hit) return hit;
  } catch {
    // キャッシュが使えない環境でも解析は続ける
  }
  const v = await compute();
  cachePut(k, v).catch(() => {});
  return v;
}

export function analyzeMotion(file: File, progress?: (f: number) => void): Promise<Float32Array> {
  return cached(cacheKey('motion', file), async () => {
    const r = request({ type: 'motion', file }, [], progress);
    const m = await r.done;
    if (m.type !== 'motion') throw new Error('unexpected');
    return m.motion;
  });
}

export interface AudioAnalysis {
  onset: Float32Array;
  bpm: number;
  beats: number[];
}

// GUI版(ffmpeg で 22050Hz モノラル → librosa)と同じ入力にするため、元のサンプルレートでデコードし直す
export function analyzeAudio(file: File, progress?: (f: number) => void): Promise<AudioAnalysis> {
  return cached(cacheKey('audio', file), async () => {
    const song = await decodeSong(file);
    const channels = Array.from({ length: song.numberOfChannels }, (_, c) => song.getChannelData(c).slice());
    const r = request({ type: 'audio', channels, sampleRate: song.sampleRate }, channels.map((c) => c.buffer), progress);
    const m = await r.done;
    if (m.type !== 'audio') throw new Error('unexpected');
    return { onset: m.onset, bpm: m.bpm, beats: m.beats };
  });
}
