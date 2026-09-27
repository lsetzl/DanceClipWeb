// 実データで自動合わせの新旧を比べる(手元用)。usage: npx tsx tests/lock-compare.ts <name>
import { readFileSync } from 'node:fs';
import { estimateBpm } from '../src/dsp/beat';
import { beatLock, beatLockStable } from '../src/dsp/lock';

const ref = JSON.parse(readFileSync(`poc-out/ref_${process.argv[2]}.json`, 'utf8'));
const motion: number[] = ref.motion, onset = Float32Array.from(ref.onset as number[]);
const trueOff = ref.v_ref_ms - ref.a_ref_ms;
const vDurMs = (motion.length / 50) * 1000;

function press(kind: 'old' | 'new', off: number, vAnchor: number, center: number) {
  const aAnchor = vAnchor - off;
  if (kind === 'old') return beatLock(motion, onset, vAnchor, aAnchor, estimateBpm(onset, aAnchor / 1000)).delta_ms;
  const bpm = estimateBpm(onset, Math.round((vAnchor - center) / 10000) * 10);
  return beatLockStable(motion, onset, vAnchor, off, bpm, center).delta_ms;
}

const rows: string[] = [];
const stats = { old: { second0: 0, presses: 0, finals: [] as number[] }, new: { second0: 0, presses: 0, finals: [] as number[] } };
let cases = 0;
for (let vAnchor = 8000; vAnchor < vDurMs - 8000; vAnchor += 6000) {
  for (const pert of [-200, -100, -40, 0, 60, 140]) {
    cases++;
    for (const kind of ['old', 'new'] as const) {
      let off = trueOff + pert, n = 0, first = 0, second = NaN;
      const center = off;
      for (; n < 10; n++) {
        const d = press(kind, off, vAnchor, center);
        if (n === 0) first = d;
        if (n === 1) second = d;
        if (d === 0) break;
        off += d;
      }
      if (second === 0 || first === 0) stats[kind].second0++;
      stats[kind].presses += n;
      stats[kind].finals.push(off - trueOff);
      if (pert === 0) rows.push(`${kind} v=${vAnchor} start=+0 -> 1st ${first}ms, 2nd ${second}ms, settled at ${off - trueOff}ms after ${n} presses`);
    }
  }
}
console.log(rows.join('\n'));
for (const k of ['old', 'new'] as const) {
  const f = stats[k].finals.map(Math.abs).sort((a, b) => a - b);
  console.log(`${k}: 2回目で止まる ${stats[k].second0}/${cases}, 平均押下 ${(stats[k].presses / cases).toFixed(2)}, 正解からのずれ 中央値 ${f[f.length >> 1]}ms / 90% ${f[Math.floor(f.length * 0.9)]}ms`);
}
