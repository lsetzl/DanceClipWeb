"""PoC の出力を CLI版の出力と比べる。usage: python tools/compare.py web.mp4 cli.mp4"""
import json
import re
import subprocess
import sys

import numpy as np
from scipy.signal import correlate

SR = 8000


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=codec_type,codec_name,duration,nb_frames,bit_rate,start_time:format=duration",
                          "-of", "json", path], capture_output=True, text=True).stdout
    return json.loads(out)


def pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.float32)


def audio_lag_ms(a, b):
    n = min(len(a), len(b))
    c = correlate(a[:n], b[:n], mode="full", method="fft")
    lag = int(np.argmax(c)) - (n - 1)
    return lag * 1000 / SR, float(c.max() / (np.linalg.norm(a[:n]) * np.linalg.norm(b[:n]) + 1e-12))


def edges(x, thr=1e-3, win_ms=10):
    w = SR * win_ms // 1000
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same"))
    loud = np.nonzero(rms > thr)[0]
    return loud[0] * 1000 / SR, (len(x) - loud[-1]) * 1000 / SR


def luma(path):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, 18 * 32).mean(axis=1)


def ssim(a, b):
    err = subprocess.run(["ffmpeg", "-v", "info", "-i", a, "-i", b, "-lavfi", "[0:v]fps=30[a];[1:v]fps=30[b];[a][b]ssim", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.search(r"All:([\d.]+)", err)
    return float(m.group(1)) if m else None


def main(web, cli):
    for p in (web, cli):
        s = {x["codec_type"]: x for x in probe(p)["streams"]}
        print(p)
        for k, v in s.items():
            print(f"  {k}: {v.get('codec_name')} dur={v.get('duration')} frames={v.get('nb_frames')} "
                  f"br={int(v.get('bit_rate', 0)) / 1e6:.2f}Mbps start={v.get('start_time')}")
    a, b = pcm(web), pcm(cli)
    lag, corr = audio_lag_ms(a, b)
    print(f"audio lag web-cli = {lag:+.2f} ms (corr {corr:.4f})")
    print(f"audio len web={len(a) / SR:.3f}s cli={len(b) / SR:.3f}s")
    print(f"audio fade-edge(ms, start/end silence) web={edges(a)} cli={edges(b)}")
    la, lb = luma(web), luma(cli)
    for name, l in (("web", la), ("cli", lb)):
        dark = l < 1.5
        print(f"video {name}: frames={len(l)} black-head={np.argmax(~dark)} black-tail={np.argmax(~dark[::-1])} "
              f"luma[0:4]={np.round(l[:4], 1).tolist()} luma[-4:]={np.round(l[-4:], 1).tolist()}")
    print(f"SSIM = {ssim(web, cli)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
