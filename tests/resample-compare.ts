// ffmpeg の -ar 22050 と自作リサンプラーを比べる。usage: npx tsx tests/resample-compare.ts <audio>
import { execFileSync } from 'node:child_process';
import { resample } from '../src/dsp/resample';

const dec = (args: string[]) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', process.argv[2], '-map', '0:a:0', '-ac', '1', ...args, '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', process.argv[2]]).toString().trim();
const native = dec([]);
const ref = dec(['-ar', '22050']);
const t0 = performance.now();
const mine = resample(native, parseInt(probe, 10), 22050);
console.log('rate', probe, 'len', mine.length, ref.length, `${(performance.now() - t0).toFixed(0)}ms`);
for (const shift of [-2, -1, 0, 1, 2]) {
  let e = 0, p = 0;
  for (let i = 1000; i < Math.min(mine.length, ref.length) - 1000; i++) {
    const d = mine[i + shift] - ref[i];
    e += d * d;
    p += ref[i] * ref[i];
  }
  console.log('shift', shift, 'SNR dB', (10 * Math.log10(p / e)).toFixed(1));
}
