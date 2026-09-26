import { beatTrack, estimateBpm } from '../dsp/beat';
import { motionEnergy } from '../dsp/motion';
import { onsetStrength, SR } from '../dsp/onset';
import { resample } from '../dsp/resample';

export type WorkerRequest =
  | { id: number; type: 'motion'; file: Blob }
  | { id: number; type: 'audio'; channels: Float32Array[]; sampleRate: number }
  | { id: number; type: 'cancel'; target: number };

export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'motion'; motion: Float32Array }
  | { id: number; type: 'audio'; onset: Float32Array; bpm: number; beats: number[] }
  | { id: number; type: 'error'; message: string };

const aborts = new Map<number, AbortController>();
const post = (m: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'cancel') {
    aborts.get(m.target)?.abort();
    return;
  }
  const ac = new AbortController();
  aborts.set(m.id, ac);
  let lastPost = 0;
  const progress = (fraction: number) => {
    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      post({ id: m.id, type: 'progress', fraction });
    }
  };
  try {
    if (m.type === 'motion') {
      const motion = await motionEnergy(m.file, progress, ac.signal);
      post({ id: m.id, type: 'motion', motion }, [motion.buffer]);
    } else {
      const n = m.channels[0].length;
      const mono = new Float32Array(n);
      // ffmpeg の -ac 1 と同じく、ステレオは (L+R)/√2
      const k = m.channels.length === 2 ? Math.SQRT1_2 : 1 / m.channels.length;
      for (const ch of m.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] * k;
      progress(0.02);
      const onset = onsetStrength(resample(mono, m.sampleRate, SR), (f) => progress(0.1 + 0.9 * f));
      const bpm = estimateBpm(onset);
      const beats = beatTrack(onset, bpm);
      post({ id: m.id, type: 'audio', onset, bpm, beats }, [onset.buffer]);
    }
  } catch (err) {
    post({ id: m.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    aborts.delete(m.id);
  }
};
