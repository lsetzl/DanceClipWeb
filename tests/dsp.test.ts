// デスクトップ版(Python / librosa / scipy / ffmpeg)で作った正解データとの突き合わせ。正解は tools/make_fixtures.py で作る
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beatTrack, estimateBpm } from '../src/dsp/beat';
import { highpass } from '../src/dsp/filter';
import { beatLock, beatLockStable } from '../src/dsp/lock';
import { estimateBarPhase } from '../src/dsp/bars';
import { onsetStrength } from '../src/dsp/onset';
import { resample } from '../src/dsp/resample';
import { beatAudio, HZ, motionSignal, SR, tones } from './signals';

const ref = JSON.parse(readFileSync(new URL('./fixtures/dsp.json', import.meta.url), 'utf8'));
const onset = onsetStrength(beatAudio());
const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe('librosa の移植', () => {
  it('onset_strength が一致する', () => {
    expect(onset.length).toBe(ref.onset.length);
    expect(maxAbs(onset, ref.onset)).toBeLessThan(2e-3);
  });

  it('BPM が一致する(全体と位置別)', () => {
    expect(estimateBpm(onset)).toBeCloseTo(ref.bpm, 9);
    for (const [c, bpm] of Object.entries<number>(ref.local_bpm)) expect(estimateBpm(onset, Number(c))).toBeCloseTo(bpm, 9);
  });

  it('拍の位置が一致する', () => {
    const beats = beatTrack(onset, ref.bpm);
    expect(beats.length).toBe(ref.beats.length);
    expect(maxAbs(beats, ref.beats)).toBeLessThan(1e-3);
  });
});

describe('scipy の移植と吸着', () => {
  it('butter(4) + sosfiltfilt のハイパスが一致する', () => {
    expect(maxAbs(highpass(ref.hp_in, ref.hp_cutoff, HZ), ref.hp_out)).toBeLessThan(1e-5);
  });

  it('beat_lock の移動量と相関が一致する', () => {
    const motion = motionSignal(onset.length, 0.12);
    for (const l of ref.locks) {
      const r = beatLock(motion, onset, l.v, l.a, estimateBpm(onset, l.a / 1000));
      expect(r.delta_ms).toBe(l.delta_ms);
      expect(r.correlation).toBeCloseTo(l.correlation, 3);
      expect(r.applied).toBe(l.applied);
    }
  });
});

describe('ffmpeg のリサンプラーの移植', () => {
  for (const rate of [44100, 48000]) {
    it(`${rate}Hz → 22050Hz が ffmpeg と一致する`, () => {
      const r = ref.resample[String(rate)];
      const out = resample(tones(rate, 2), rate, SR);
      expect(out.length).toBe(r.length);
      let e = 0, p = 0;
      for (let i = 0; i < r.samples.length; i++) {
        e += (out[r.start + i] - r.samples[i]) ** 2;
        p += r.samples[i] ** 2;
      }
      expect(10 * Math.log10(p / e)).toBeGreaterThan(80);
    });
  }
});

describe('自動合わせ(何度押しても同じ位置に落ち着く版)', () => {
  const motion = motionSignal(onset.length, 0.12);
  const bpm = estimateBpm(onset);
  const beatMs = 60000 / bpm;
  const starts = [0, 60, 200, -60, 33, -47];
  const landed = starts.map((start) => start + beatLockStable(motion, onset, 12000, start, bpm).delta_ms);

  it('押し直すと動かない', () => {
    starts.forEach((start, i) => {
      expect(beatLockStable(motion, onset, 12000, landed[i], bpm, start).delta_ms).toBe(0);
    });
  });

  it('どこから押しても、拍の周期で見て同じ位置に落ち着く', () => {
    for (const x of landed) {
      const d = (((x - landed[0]) % beatMs) + beatMs) % beatMs;
      expect(Math.min(d, beatMs - d)).toBeLessThanOrEqual(20);
    }
  });

  it('1 回目の結果が GUI 版の計算と 20ms 以内で一致する', () => {
    starts.forEach((start, i) => {
      const old = start + beatLock(motion, onset, 12000, 12000 - start, bpm).delta_ms;
      expect(Math.abs(landed[i] - old)).toBeLessThanOrEqual(20);
    });
  });

  it('曲の範囲の外を比べることになる位置ではエラーにする', () => {
    expect(() => beatLockStable(motion, onset, 15000, -20000, bpm)).toThrow();
  });
});

describe('小節の頭の推定', () => {
  // 0.5 秒ごとの拍。位相 1 の拍からコードが変わり、キックは位相 1 と 3 の拍に入る
  const beats = Array.from({ length: 64 }, (_, i) => 1 + i * 0.5);
  const frames = 50 * 40;
  const chroma = new Float32Array(frames * 12);
  const low = new Float32Array(frames).fill(-3);
  beats.forEach((b, i) => {
    const bar = Math.floor((i - 1) / 4);
    const pc = [0, 5, 7, 9][((bar % 4) + 4) % 4];
    for (let t = Math.round(b * 50); t < Math.round((b + 0.5) * 50); t++) chroma[t * 12 + pc] = 1;
    if ((i - 1) % 2 === 0) for (let t = Math.round(b * 50); t < Math.round(b * 50) + 3; t++) low[t] = 0;
  });

  it('コードの変化とキックの位置から位相を選ぶ', () => {
    expect(estimateBarPhase(beats, { chroma, low })).toBe(1);
  });
});
