// Python(GUI版)の解析結果と TS 版を突き合わせる。usage: npx tsx tests/dsp-compare.ts <name> [song.f32]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beatTrack, estimateBpm } from '../src/dsp/beat';
import { highpass } from '../src/dsp/filter';
import { beatLock } from '../src/dsp/lock';
import { HZ, onsetStrength, SR } from '../src/dsp/onset';

const name = process.argv[2];
const ref = JSON.parse(readFileSync(`poc-out/ref_${name}.json`, 'utf8'));
const onset = Float32Array.from(ref.onset as number[]);
const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

const hp = highpass(ref.hp_in, ref.hp_cutoff, HZ);
console.log('highpass max|diff|', maxAbs(hp, ref.hp_out).toExponential(2));

const bpm = estimateBpm(onset);
console.log('bpm', bpm, 'ref', ref.bpm);
for (const [c, v] of Object.entries(ref.local_bpm)) console.log(`  local@${c}`, estimateBpm(onset, Number(c)), 'ref', v);

const beats = beatTrack(onset, ref.bpm);
const rb: number[] = ref.beats;
console.log('beats', beats.length, 'ref', rb.length, 'max|diff| s', beats.length === rb.length ? maxAbs(beats, rb) : 'len mismatch');

for (const [dv, r] of Object.entries<any>(ref.locks)) {
  const lb = estimateBpm(onset, ref.a_ref_ms / 1000);
  const t = beatLock(ref.motion, onset, ref.v_ref_ms + Number(dv), ref.a_ref_ms, lb);
  console.log(`lock dv=${dv}`, t.delta_ms, t.correlation.toFixed(4), t.applied, '| ref', r.delta_ms, r.correlation.toFixed(4), r.applied);
}

const audio = process.argv[3];
if (audio) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', audio, '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const t0 = performance.now();
  const o = onsetStrength(y);
  console.log('onset len', o.length, 'ref', onset.length, 'max|diff|', maxAbs(o, onset).toFixed(4), 'mean', (onset.reduce((a, b) => a + b, 0) / onset.length).toFixed(3), `${(performance.now() - t0).toFixed(0)}ms`);
  const b2 = beatTrack(o, estimateBpm(o));
  console.log('beats from TS onset', b2.length, 'bpm', estimateBpm(o), 'max|diff| s', b2.length === rb.length ? maxAbs(b2, rb) : 'len mismatch');
}
