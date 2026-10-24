# -*- coding: utf-8 -*-
import sys, glob
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from PIL import Image

paths = []
for p in glob.glob("reference/core/images/*.jpg"):
    try:
        im = Image.open(p)
        if im.size == (256, 256):
            paths.append(p)
    except Exception:
        pass
N = len(paths)
S = 18
small = np.zeros((N, 64, 64, 3), dtype=np.float32)
for i, p in enumerate(paths):
    small[i] = np.asarray(Image.open(p).resize((64, 64), Image.BILINEAR), dtype=np.float32)

TOP = small[:, 0, :, :]
BOT = small[:, -1, :, :]
LEF = small[:, :, 0, :]
RIG = small[:, :, -1, :]


def cost_right(a, b):
    return np.mean(np.abs(RIG[a][None] - LEF[b]), axis=(1, 2))


def cost_bottom(a, b):
    return np.mean(np.abs(BOT[a][None] - TOP[b]), axis=(1, 2))


place = np.full((S, S), -1, dtype=np.int32)
used = np.zeros(N, dtype=bool)
place[0, 0] = 0
used[0] = True
allidx = np.arange(N)

for r in range(S):
    for c in range(S):
        if r == 0 and c == 0:
            continue
        score = np.zeros(N, dtype=np.float32)
        if c > 0:
            score += cost_right(place[r, c - 1], allidx)
        if r > 0:
            score += cost_bottom(place[r - 1, c], allidx)
        score[used] = 1e9
        k = int(np.argmin(score))
        place[r, c] = k
        used[k] = True

canvas = Image.new("RGB", (S * 256, S * 256))
for r in range(S):
    for c in range(S):
        canvas.paste(Image.open(paths[place[r, c]]), (c * 256, r * 256))
canvas.save("shots/leicester_full.jpg", quality=90)
canvas.resize((1000, 1000), Image.LANCZOS).save("shots/leicester_solved.jpg", quality=88)
np.save("shots/leicester_place.npy", place)
print("-> shots/leicester_full.jpg", canvas.size)
