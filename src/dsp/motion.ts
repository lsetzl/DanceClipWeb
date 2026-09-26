// GUI版の motion_energy(ffmpeg fps=50,scale=64:36,format=gray の隣接フレーム差分)の移植
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { HZ } from './onset';

const W = 64, H = 36;

export async function motionEnergy(file: Blob, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no-video-track');
    const sink = new VideoSampleSink(track);
    const duration = await track.computeDuration();
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const slots: number[] = [];
    const grays: Uint8Array[] = [];
    for await (const s of sink.samples()) {
      if (signal?.aborted) {
        s.close();
        throw new DOMException('aborted', 'AbortError');
      }
      ctx.drawImage(s.toCanvasImageSource(), 0, 0, W, H);
      const t = s.timestamp;
      s.close();
      const px = ctx.getImageData(0, 0, W, H).data;
      const g = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) g[i] = 16 + 0.1826 * px[i * 4] + 0.6142 * px[i * 4 + 1] + 0.062 * px[i * 4 + 2] + 0.5;
      slots.push(Math.round(t * HZ));
      grays.push(g);
      onProgress?.(Math.min(1, t / duration));
    }
    if (grays.length < 2) return new Float32Array(0);

    // fps フィルタ(round=near)と同じく、50Hz の各コマにはその時刻までに来た最新のフレームを使う
    const n = Math.round(duration * HZ);
    const out = new Float32Array(Math.max(0, n - 1));
    let j = 0;
    let prev = grays[0];
    for (let k = 1; k < n; k++) {
      while (j + 1 < grays.length && slots[j + 1] <= k) j++;
      const cur = grays[j];
      if (cur !== prev) {
        let s = 0;
        for (let i = 0; i < W * H; i++) s += Math.abs(cur[i] - prev[i]);
        out[k - 1] = s;
        prev = cur;
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}
