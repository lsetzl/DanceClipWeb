"""出力を元動画とフレーム番号で対応させて SSIM / PSNR を出す(先頭と末尾のフェードは避ける)。
usage: python tools/quality.py source.mp4 trim_start_s out.mp4"""
import re
import subprocess
import sys


def first_index(src, start):
    pts = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "packet=pts_time",
                          "-of", "csv=p=0", src], capture_output=True, text=True).stdout.split()
    return sum(1 for t in pts if float(t) < start - 1e-6)


def measure(src, out, k, a=60, n=1200):
    g = (f"[0:v]select='between(n,{a},{a + n - 1})',setpts=N/30/TB,split[o1][o2];"
         f"[1:v]select='between(n,{a + k},{a + k + n - 1})',setpts=N/30/TB,split[s1][s2];"
         f"[o1][s1]ssim;[o2][s2]psnr")
    err = subprocess.run(["ffmpeg", "-v", "info", "-i", out, "-i", src, "-lavfi", g,
                          "-fps_mode", "passthrough", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    s = re.search(r"SSIM .*All:([\d.]+)", err)
    p = re.search(r"PSNR .*average:([\d.inf]+)", err)
    return float(s.group(1)) if s else None, p.group(1) if p else None


if __name__ == "__main__":
    src, start, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    k0 = first_index(src, start)
    res = {k: measure(src, out, k) for k in (k0 - 1, k0, k0 + 1)}
    best = max(res, key=lambda k: res[k][0] or 0)
    print(f"{out}: SSIM={res[best][0]} PSNR={res[best][1]} (shift {best - k0:+d}; all={res})")
