"""GUI版(DanceClipGui)の解析結果を、TS 版と突き合わせるための JSON に書き出す。
usage: python tools/dump_reference.py <DanceClipGui のパス> <name> <video> <audio> <v_ref_ms> <a_ref_ms>
出力: poc-out/ref_<name>.json"""
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from dc import auto_sync  # noqa: E402

name, video, audio = sys.argv[2], sys.argv[3], sys.argv[4]
v_ref, a_ref = int(sys.argv[5]), int(sys.argv[6])

onset = auto_sync.onset_envelope(audio)
motion = auto_sync.motion_energy(video)
bpm = auto_sync.estimate_bpm(onset)
beats = auto_sync.beat_times(onset, bpm)
local = {str(c): auto_sync.estimate_bpm(onset, c) for c in (0.0, 30.0, 60.0, 120.0, a_ref / 1000.0)}
locks = {}
for dv in (-300, -120, 0, 90, 250):
    vr = v_ref + dv
    lbpm = auto_sync.estimate_bpm(onset, a_ref / 1000.0)
    locks[str(dv)] = auto_sync.beat_lock(motion, onset, vr, a_ref, lbpm)
hp = auto_sync.highpass(onset[1000:1400], auto_sync.hp_cutoff(bpm))

out = {
    "hz": auto_sync.HZ,
    "onset": [round(float(x), 5) for x in onset],
    "motion": [round(float(x), 1) for x in motion],
    "bpm": bpm,
    "beats": [round(float(x), 4) for x in beats],
    "local_bpm": local,
    "locks": locks,
    "hp_in": [round(float(x), 6) for x in onset[1000:1400]],
    "hp_out": [round(float(x), 6) for x in hp],
    "hp_cutoff": auto_sync.hp_cutoff(bpm),
    "v_ref_ms": v_ref,
    "a_ref_ms": a_ref,
}
Path("poc-out").mkdir(exist_ok=True)
Path(f"poc-out/ref_{name}.json").write_text(json.dumps(out), encoding="utf-8")
print(name, "bpm", bpm, "beats", len(beats), "onset", len(onset), "motion", len(motion))
