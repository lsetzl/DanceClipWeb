"""CI 用の解析テストの正解データ(tests/fixtures/dsp.json)を作る。
デスクトップ版(DanceClipGui)の dc/auto_sync.py と librosa、ffmpeg が必要。入力の信号は tests/signals.ts と同じ式で作る。
usage: python tools/make_fixtures.py <DanceClipGui のパス>"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, sys.argv[1])
from dc import auto_sync  # noqa: E402

SR = 22050
HZ = 50
BPM = 128.0
PERIOD = 60.0 / BPM
T0 = 0.5
DUR = 30.0


def beat_audio(sr, dur):
    t = np.arange(int(dur * sr), dtype=np.float64) / sr
    k = np.floor((t - T0) / PERIOD)
    tk = T0 + k * PERIOD
    dt = t - tk
    on = t >= T0
    kick = np.where(on, 0.8 * np.exp(-dt / 0.03) * np.sin(2 * np.pi * 60 * dt), 0.0)
    dh = dt - PERIOD / 2
    hat = np.where(on & (dh >= 0), 0.2 * np.exp(-np.maximum(dh, 0) / 0.008) * np.sin(2 * np.pi * 7000 * dh + 3 * np.sin(2 * np.pi * 1300 * dh)), 0.0)
    pad = 0.1 * np.sin(2 * np.pi * 220 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.2 * t))
    return (kick + hat + pad).astype(np.float32)


def motion_signal(n, lag_s):
    k = np.arange(n, dtype=np.float64)
    beats = T0 + np.arange(int(DUR / PERIOD) + 2) * PERIOD
    peaks = np.max(np.exp(-(((k / HZ)[:, None] - (beats[None, :] + lag_s)) / 0.04) ** 2), axis=1)
    return 1000 * peaks + 80 * np.sin(k * 0.37) ** 2 + 30 * np.sin(k * 1.9) ** 2


def tones(sr, dur):
    t = np.arange(int(dur * sr), dtype=np.float64) / sr
    y = 0.5 * np.sin(2 * np.pi * 440 * t) + 0.3 * np.sin(2 * np.pi * 5000 * t) + 0.15 * np.sin(2 * np.pi * 10500 * t) + 0.05 * np.sin(2 * np.pi * 12000 * t)
    return y.astype(np.float32)


def ffmpeg_resample(x, rate):
    out = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-", "-ar", str(SR), "-f", "f32le", "-"],
                         input=x.tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32)


def r(a, nd=6):
    return [round(float(v), nd) for v in a]


def main():
    import librosa
    y = beat_audio(SR, DUR)
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=SR // HZ).astype(np.float32)
    bpm = auto_sync.estimate_bpm(onset)
    beats = auto_sync.beat_times(onset, bpm)
    motion = motion_signal(len(onset), 0.12)
    locks = []
    for v, a in [(10000, 10000), (12000, 12000), (15000, 14900), (20000, 20100)]:
        res = auto_sync.beat_lock(motion, onset, v, a, auto_sync.estimate_bpm(onset, a / 1000.0))
        locks.append({"v": v, "a": a, "delta_ms": res["delta_ms"], "correlation": res["correlation"], "applied": res["applied"]})
    hp_in = onset[100:500]
    hp_out = auto_sync.highpass(hp_in, auto_sync.hp_cutoff(bpm))
    resample = {}
    for rate in (44100, 48000):
        out = ffmpeg_resample(tones(rate, 2.0), rate)
        resample[str(rate)] = {"start": 10000, "samples": r(out[10000:14096], 7), "length": len(out)}
    fixture = {
        "onset": r(onset), "bpm": bpm, "beats": r(beats, 4),
        "local_bpm": {str(c): auto_sync.estimate_bpm(onset, c) for c in (5.0, 15.0, 25.0)},
        "locks": locks, "hp_cutoff": auto_sync.hp_cutoff(bpm), "hp_in": r(hp_in), "hp_out": r(hp_out),
        "resample": resample,
    }
    dst = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "dsp.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(fixture), encoding="utf-8")
    print("bpm", bpm, "beats", len(beats), "locks", [(l["delta_ms"], round(l["correlation"], 3)) for l in locks], "->", dst)


main()
