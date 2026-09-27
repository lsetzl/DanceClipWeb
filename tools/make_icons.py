"""アイコンと SNS 共有用の画像を public/ に作る。usage: python tools/make_icons.py"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public"
BG = (21, 23, 28)
BEAT = (255, 194, 79)
MOTION = (87, 213, 230)
WAVE = (86, 96, 122)

BEATS = [0.3, 0.7]


def motion_y(x):
    # 拍の位置に山が来る動きのカーブ(0..1)
    return max(math.exp(-((x - b) / 0.075) ** 2) for b in BEATS)


def svg():
    pts = " ".join(f"{8 + 48 * i / 60:.2f},{52 - 22 * motion_y(i / 60):.2f}" for i in range(61))
    beats = "".join(f'<line x1="{8 + 48 * b}" y1="12" x2="{8 + 48 * b}" y2="52" stroke="#ffc24f" stroke-width="3.5" stroke-linecap="round"/>' for b in BEATS)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#15171c"/>
{beats}
<polyline points="{pts}" fill="none" stroke="#57d5e6" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
"""


def draw_icon(size, maskable=False):
    s = 4
    n = size * s
    im = Image.new("RGB", (n, n), BG)
    d = ImageDraw.Draw(im)
    pad = n * (0.2 if maskable else 0.125)
    x0, x1, y0, y1 = pad, n - pad, pad * 1.05, n - pad * 1.05
    w = max(2, int(n * 0.04))
    for b in BEATS:
        x = x0 + (x1 - x0) * b
        d.line([(x, y0), (x, y1)], fill=BEAT, width=w)
    pts = [(x0 + (x1 - x0) * i / 200, y1 - (y1 - y0) * 0.55 * motion_y(i / 200)) for i in range(201)]
    d.line(pts, fill=MOTION, width=int(w * 1.5), joint="curve")
    im = im.resize((size, size), Image.LANCZOS)
    if not maskable:
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
        rgba = im.convert("RGBA")
        rgba.putalpha(mask.resize((size, size), Image.LANCZOS))
        return rgba
    return im


def font(names, size):
    for name in names:
        p = Path("C:/Windows/Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def og():
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    # 下半分にタイムライン風の絵(曲の波形・拍線・動きのカーブ)
    top, bottom = 380, 590
    for i in range(0, W - 120, 6):
        amp = 18 + 14 * abs(math.sin(i * 0.05)) * (0.6 + 0.4 * math.sin(i * 0.013))
        d.rectangle([60 + i, top + 40 - amp, 62 + i, top + 40 + amp], fill=WAVE)
    beats = [60 + k * 90 for k in range(13)]
    for x in beats:
        d.line([(x, top), (x, bottom)], fill=BEAT + (0,), width=3)
    pts = []
    for i in range(W - 120):
        x = 60 + i
        y = max(math.exp(-((x - b) / 14) ** 2) for b in beats)
        pts.append((x, bottom - 20 - 90 * y))
    d.line(pts, fill=MOTION, width=5, joint="curve")
    d.text((60, 70), "DanceClip", font=font(["segoeuib.ttf", "arialbd.ttf"], 110), fill=(79, 179, 255))
    d.text((64, 210), "Sync a dance video with a song and export MP4", font=font(["segoeui.ttf", "arial.ttf"], 42), fill=(228, 231, 238))
    d.text((64, 272), "ダンス動画を曲に合わせて MP4 に — ブラウザだけで完結", font=font(["YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"], 38), fill=(139, 146, 163))
    return im


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "favicon.svg").write_text(svg(), encoding="utf-8")
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512).save(OUT / "icon-512.png")
    draw_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    draw_icon(180, maskable=True).save(OUT / "apple-touch-icon.png")
    og().save(OUT / "og.png", optimize=True)
    print("written to", OUT)


main()
