#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R · 补齐图集里缺的帧（一次生成，可重复执行）

解决三件事：
  1. F1 —— 站立跳变：guy02 / girl02 / fat01 原版没有 idle 帧，站着时只能借用别人的体型。
           这里从各自的 walk 帧里挑「腿最合拢」的一帧，做呼吸/轻晃 6 帧，生成 idle01 / idle02。
  2. F5 —— 动物没有 run / die：6 帧 walk 里抽 4 帧做横向拉伸 + 上下起伏当奔跑；
           idle 帧压扁 + 拉宽当尸体。
  3. F3 —— outline（X 光透视）帧：全部按对应 solid 帧的 alpha 轮廓重新生成，
           同一动画的 solid / outline 帧数 1:1、位置完全对齐，
           这样切换时不会换动作、不会跳位。

输出到 reference/sprites/<体型>/<动画>_solid|outline/*.png
原版的 outline 帧会先备份到 reference/sprites/_outline_orig/（不覆盖备份）。

用法：python tools/gen_missing_frames.py
"""
import os, glob, shutil
import numpy as np
from PIL import Image

BASE = "reference/sprites"
ANIMALS = os.path.join(BASE, "animals")
BACKUP = os.path.join(BASE, "_outline_orig")
OUTLINE_RGB = (64, 212, 59)          # 原版描边绿（取自 guy01/idle01_outline）

IDLE_TARGETS = ["guy02", "girl02", "fat01"]
ANIMAL_RUN = 4                        # 奔跑帧数
ANIMAL_DIE = 3                        # 死亡帧数


def load(p):
    return np.asarray(Image.open(p).convert("RGBA"), dtype=np.float32) / 255.0


def save(arr, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA").save(p)


def mask_of(arr, th=0.3):
    return arr[:, :, 3] > th


def shift(arr, dx=0, dy=0):
    """整体平移，画布尺寸不变"""
    out = np.zeros_like(arr)
    h, w = arr.shape[:2]
    xs0, xs1 = max(0, dx), min(w, w + dx)
    ys0, ys1 = max(0, dy), min(h, h + dy)
    src_xs0, src_xs1 = max(0, -dx), min(w, w - dx)
    src_ys0, src_ys1 = max(0, -dy), min(h, h - dy)
    out[ys0:ys1, xs0:xs1] = arr[src_ys0:src_ys1, src_xs0:src_xs1]
    return out


def resize_keep_canvas(arr, kx, ky, anchor_bottom=True):
    """按比例缩放内容，画布不变"""
    h, w = arr.shape[:2]
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA")
    im2 = im.resize((max(1, int(round(w * kx))), max(1, int(round(h * ky)))), Image.NEAREST)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = h - im2.height if anchor_bottom else (h - im2.height) // 2
    out.alpha_composite(im2, ((w - im2.width) // 2, y))
    return np.asarray(out, dtype=np.float32) / 255.0


def standing_index(frames):
    """挑「腿最合拢」的一帧：只看下 40% 的 alpha 横向跨度"""
    best, best_w = 0, 1e9
    for i, arr in enumerate(frames):
        m = mask_of(arr)
        h = arr.shape[0]
        legs = m[int(h * 0.6):, :]
        cols = np.nonzero(legs.any(0))[0]
        if len(cols) == 0:
            continue
        w = cols.max() - cols.min() + 1
        if w < best_w:
            best_w, best = w, i
    return best


# ---------------- F1：给缺 idle 的体型合成站立帧 ----------------
def gen_idle():
    made = 0
    for t in IDLE_TARGETS:
        walk_dir = os.path.join(BASE, t, "walk_solid")
        files = sorted(glob.glob(os.path.join(walk_dir, "*.png")))
        if not files:
            print(f"  [跳过] {t}: 没有 walk_solid")
            continue
        frames = [load(f) for f in files]
        base = frames[standing_index(frames)]

        # idle01：上下呼吸 6 帧（1px 起伏，12fps 下约 0.5 秒一轮）
        seq1 = [shift(base, 0, -1), shift(base, 0, -1), base,
                base, shift(base, 0, 1), shift(base, 0, 1)]
        # idle02：左右轻晃 6 帧（站久了重心转移）
        seq2 = [shift(base, -1, 0), shift(base, -1, 0), base,
                base, shift(base, 1, 0), shift(base, 1, 0)]
        for name, seq in (("idle01_solid", seq1), ("idle02_solid", seq2)):
            d = os.path.join(BASE, t, name)
            for i, arr in enumerate(seq):
                save(arr, os.path.join(d, f"{i:02d}.png"))
        made += len(seq1) + len(seq2)
        print(f"  {t}: idle01 + idle02 各 6 帧（站立基准帧 = walk #{standing_index(frames)}）")
    return made


# ---------------- F5：动物奔跑 / 死亡 ----------------
def gen_animals():
    made = 0
    for t in sorted(os.listdir(ANIMALS)):
        d = os.path.join(ANIMALS, t)
        if not os.path.isdir(d):
            continue
        walk = sorted(glob.glob(os.path.join(d, "walk_solid", "*.png")))
        idle = sorted(glob.glob(os.path.join(d, "idle01_solid", "*.png")))
        if walk:
            frames = [load(f) for f in walk]
            n = len(frames)
            # 抽 4 帧，横向拉长 + 交替上下 1px → 四足奔跑的腾空感
            picks = [frames[(i * n // ANIMAL_RUN) % n] for i in range(ANIMAL_RUN)]
            out = [resize_keep_canvas(a, 1.14, 1.0) for a in picks]
            out = [shift(a, 0, -1 if (i % 2 == 0) else 0) for i, a in enumerate(out)]
            for i, a in enumerate(out):
                save(a, os.path.join(d, "run01_solid", f"{i:02d}.png"))
            made += len(out)
        if idle:
            base = load(idle[0])
            # 逐帧压扁 + 加宽，最后两帧停住 → 尸体定格
            out = [resize_keep_canvas(base, 1.15, 0.75),
                   resize_keep_canvas(base, 1.28, 0.58),
                   resize_keep_canvas(base, 1.28, 0.58)]
            for i, a in enumerate(out):
                save(a, os.path.join(d, "die01_solid", f"{i:02d}.png"))
            made += len(out)
    print(f"  动物：{len(os.listdir(ANIMALS))} 套 × (run01 {ANIMAL_RUN} 帧 + die01 {ANIMAL_DIE} 帧)")
    return made


# ---------------- F3：outline 帧统一按 solid 轮廓生成 ----------------
def gen_outlines():
    if not os.path.isdir(BACKUP):
        os.makedirs(BACKUP, exist_ok=True)
    made, dirs = 0, 0
    roots = [(BASE, ""), (ANIMALS, "animals/")]
    for root, prefix in roots:
        for t in sorted(os.listdir(root)):
            tp = os.path.join(root, t)
            if not os.path.isdir(tp) or t.startswith("_"):
                continue
            for a in sorted(os.listdir(tp)):
                if not a.endswith("_solid"):
                    continue
                src = sorted(glob.glob(os.path.join(tp, a, "*.png")))
                if not src:
                    continue
                dst_name = a[:-len("_solid")] + "_outline"
                dst = os.path.join(tp, dst_name)
                # 原版 outline 只备份一次
                if os.path.isdir(dst) and not os.path.isdir(os.path.join(BACKUP, prefix + t, dst_name)):
                    shutil.copytree(dst, os.path.join(BACKUP, prefix + t, dst_name))
                for i, f in enumerate(src):
                    arr = load(f)
                    m = mask_of(arr)
                    out = np.zeros_like(arr)
                    out[m] = [OUTLINE_RGB[0] / 255.0, OUTLINE_RGB[1] / 255.0, OUTLINE_RGB[2] / 255.0, 1.0]
                    save(out, os.path.join(dst, f"{i:02d}.png"))
                    made += 1
                dirs += 1
    print(f"  outline：{dirs} 个动画目录，{made} 帧（与 solid 一一对齐）")
    return made


def main():
    print("1) 站立帧（F1）")
    a = gen_idle()
    print("2) 动物奔跑 / 死亡（F5）")
    b = gen_animals()
    print("3) outline 轮廓（F3）")
    c = gen_outlines()
    print(f"\n合计生成 {a + b + c} 帧。接着跑：python tools/build_retro_atlas2.py")


if __name__ == "__main__":
    main()
