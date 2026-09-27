// デスクトップ版(Python / librosa / scipy / ffmpeg)で作った正解データとの突き合わせ。正解は tools/make_fixtures.py で作る
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beatTrack, estimateBpm } from '../src/dsp/beat';
import { highpass } from '../src/dsp/filter';
import { beatLock } from '../src/dsp/lock';
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
