"""腹部の患者画像を作る（試作 v04 の P94）。

ユーザーが用意した体の内部のイラスト（リポジトリのルートの disease.jpg）から、
字と引き出し線を消し、kanja_01.jpg のように青を基調とした画像にする。
画像の全体を、手術エリア（横2：縦1）の中央に置き、左右を黒で埋めて patient_abdomen_0.jpg を出力する（2026-11-12 ユーザー指示：一部ではなく全体）。

使い方（リポジトリのルートで）:
    python _prototype_v04/tools/make_abdomen.py disease.jpg

注意（2026-11-12）：元画像は公開しないためリポジトリに無い。出力した画像はユーザーが手直し済みなので、
このスクリプトを流すと手直しが消える。記録として残している。
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets" / "images"
SIZE = (1400, 700)                   # 手術エリアの論理サイズ


def line_mask(a):
    """字・引き出し線（灰色で暗い）の画素"""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    gray = (mx - mn) < 60
    return gray & (mx < 200)


def inpaint(a, mask, iters=60):
    """マスクの画素を、周りの画素の平均で少しずつ埋める（簡易の穴埋め）"""
    a = a.astype(np.float32).copy()
    known = ~mask
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            sa = np.roll(a, (dy, dx), (0, 1))
            sk = np.roll(known, (dy, dx), (0, 1))
            acc += sa * sk[..., None]
            cnt += sk
        fill = (~known) & (cnt > 0)
        a[fill] = acc[fill] / cnt[fill][:, None]
        known = known | fill
    return a


def main(src):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.int32)
    # 1) 字と線を消す（少し太らせてから穴埋め）
    m = line_mask(a)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
    bg = (a.min(-1) > 240)                       # 白い背景
    m &= ~bg
    # 線の画素が背景か体かは、まわりの線以外の画素のうち背景が多いかで決める
    def box(x, r=6):
        return np.asarray(Image.fromarray((x * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(r))).astype(np.float32)
    ratio = box(bg & ~m) / np.maximum(box(~m), 1)
    line_bg = m & (ratio > 0.5)
    # 体の中の線は、体の画素（背景を除く）だけを元に埋める
    a = inpaint(a, m | bg)
    bg = bg | line_bg
    # 背景は、画像の端とつながった部分だけ（体の中の白っぽい画素は背景にしない）
    reach = np.zeros_like(bg)
    reach[0, :] = bg[0, :]; reach[-1, :] = bg[-1, :]; reach[:, 0] = bg[:, 0]; reach[:, -1] = bg[:, -1]
    while True:
        grow = reach.copy()
        grow[1:, :] |= reach[:-1, :]; grow[:-1, :] |= reach[1:, :]; grow[:, 1:] |= reach[:, :-1]; grow[:, :-1] |= reach[:, 1:]
        grow &= bg
        if (grow == reach).all():
            break
        reach = grow
    inner = bg & ~reach                          # 体の中にあった白っぽい画素：まわりの体の色で埋める
    a = inpaint(a, inner | reach)
    bg = reach
    # 2) 背景（白）を黒に、体を青に
    lum = (0.30 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]) / 255.0
    sat = (a.max(-1) - a.min(-1)) / 255.0
    # 臓器の違いが分かるよう、明るさと彩度の両方から濃さを決める
    t = np.clip((lum - 0.45) / 0.5 - sat * 0.6 + 0.25, 0, 1)
    dark = np.array([10, 45, 140], np.float32)
    light = np.array([120, 200, 255], np.float32)
    out = dark + (light - dark) * t[..., None]
    out[bg] = 0
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    # 全体を高さに合わせて縮小し、横2：縦1 の黒い画面の中央に置く
    h = SIZE[1]
    w = round(img.width * h / img.height)
    body = img.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    canvas = Image.new("RGB", SIZE, (0, 0, 0))
    canvas.paste(body, ((SIZE[0] - w) // 2, 0))
    img = canvas
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / "patient_abdomen_0.jpg", quality=88)
    print("wrote", OUT / "patient_abdomen_0.jpg")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "disease.jpg")
