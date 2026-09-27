// 小節の頭の推定を beat_this(研究用の検出器)の結果と比べる(手元用)。usage: npx tsx tests/bars-compare.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beatTrack, estimateBpm } from '../src/dsp/beat';
import { beatScores, estimateBarPhase, estimateBarPhases } from '../src/dsp/bars';
import { onsetStrength, SR } from '../src/dsp/onset';
import { resample } from '../src/dsp/resample';

const M = 'C:/Users/lsetz/マイドライブ（lsetzl@gmail.com）/music/';
const songs: Record<string, string> = {
  brave: M + 'Leina/BRAVE FIGHTER/001-BRAVE FIGHTER.m4a',
  save: M + "I've/I've 20th Anniversary E-VOX [Disc 2]/03 SAVE YOUR HEART.mp3",
  ride: M + "I've/Ive Members Concept Compilation ALBUM vol,02 SUMMER END GROOVE/04_RIDE -I want to feel again mix-.mp3",
};
const ref = JSON.parse(readFileSync('poc-out/beatthis.json', 'utf8'));

function decode(path: string) {
  const rate = parseInt(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', path]).toString(), 10);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return resample(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), rate, SR);
}

const near = (t: number, list: number[], tol = 0.07) => list.some((x) => Math.abs(x - t) <= tol);

for (const [name, path] of Object.entries(songs)) {
  const y = decode(path);
  const n = 1 + Math.floor(y.length / (SR / 50));
  const extras = { chroma: new Float32Array(n * 12), low: new Float32Array(n) };
  const onset = onsetStrength(y, undefined, extras);
  const beats = beatTrack(onset, estimateBpm(onset));
  const refDown: number[] = ref[name].downbeats;
  // 各位相で、自分の拍のうち小節の頭とみなしたものが参照の小節の頭と一致する割合
  const rate = (isDown: (i: number) => boolean) => {
    let hit = 0, total = 0;
    beats.forEach((t, i) => {
      if (!isDown(i)) return;
      total++;
      if (near(t, refDown)) hit++;
    });
    return hit / (total || 1);
  };
  const perPhase = [0, 1, 2, 3].map((p) => rate((i) => (i - p) % 4 === 0 || (i - p) % 4 === -0));
  const results: string[] = [];
  for (const w of [0, 0.5, 1]) {
    const p = estimateBarPhase(beats, extras, w);
    results.push(`global(w=${w}) phase=${p} -> ${(perPhase[p] * 100).toFixed(0)}%`);
    for (const hw of [8, 16, 32]) {
      const ph = estimateBarPhases(beats, extras, hw, w);
      results.push(`local(w=${w},±${hw}) -> ${(rate((i) => ((i - ph[i]) % 4 + 4) % 4 === 0) * 100).toFixed(0)}%`);
    }
  }
  // 参照の拍と自分の拍がそもそも一致しているか
  const beatAgree = beats.filter((t) => near(t, ref[name].beats)).length / beats.length;
  void beatScores;
  console.log(`== ${name}: beats ${beats.length} (参照と一致 ${(beatAgree * 100).toFixed(0)}%), 位相ごとの一致 ${perPhase.map((r) => (r * 100).toFixed(0) + '%').join(' / ')}`);
  console.log('   ' + results.join('\n   '));
}
