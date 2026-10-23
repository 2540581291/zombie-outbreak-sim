# -*- coding: utf-8 -*-
"""
审计 assets/atlas/atlas.json 是否与原版一致（P1 的验收脚本）。

    python tools/audit_atlas.py

检查项：
  1. 每个 clip 的 n / ms / rect 数 是否等于反编译里的 _qk83() / _br451()
  2. 所有 rect 是否越界；**不同的 rect** 之间是否重叠（重叠 = UV 串帧）
     —— 注意：同一个 rect 被多个 clip 共用是**故意**的（原版警察复用 guy01 的僵尸动画）
  3. 图集尺寸、阴影图
"""
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import json

import numpy as np
from PIL import Image

AS = "reference/core/scripts/src/animationfactory"
ATLAS = "assets/atlas/atlas.json"
PNG = "assets/atlas/atlas.png"

TYPES = ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]
ANIMS = ["walk", "idle01", "idle02", "run01", "shoot01", "die01",
         "turn01", "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]


def meta(path, fn):
    m = re.search(r"function %s\(\)\s*:\s*\w+\s*\{\s*return ([^;]+);" % fn,
                  open(path, encoding="utf-8", errors="replace").read())
    return m.group(1).strip() if m else None


def main():
    doc = json.load(open(ATLAS, encoding="utf-8"))
    W, H = doc["w"], doc["h"]
    clips = doc["clips"]
    bad = []

    # 1) 帧数 / 帧长
    checked = 0
    for typ in TYPES:
        for anim in ANIMS:
            p = os.path.join(AS, typ, anim, "_sj1166.as")
            if not os.path.exists(p):
                continue                      # police01 的 4 支僵尸动画：原版复用 guy01
            n = int(meta(p, "_qk83"))
            ms = int(meta(p, "_br451"))
            for suffix in ("", "@sil"):
                key = "%s/%s%s" % (typ, anim, suffix)
                if key not in clips:
                    bad.append("缺 clip: " + key)
                    continue
                c = clips[key]
                checked += 1
                if c["n"] != n:
                    bad.append("%s 帧数 %d != _qk83 %d" % (key, c["n"], n))
                if c["ms"] != ms:
                    bad.append("%s 帧长 %d != _br451 %d" % (key, c["ms"], ms))
                if len(c["frames"]) != c["n"]:
                    bad.append("%s rect 数 %d != n %d" % (key, len(c["frames"]), c["n"]))

    # 2) 越界 + 不同 rect 之间的重叠（用 numpy 盖印章，快且可靠）
    rects = sorted({tuple(f) for c in clips.values() for f in c["frames"]})
    owner = np.full((H, W), -1, dtype=np.int32)
    overlap = 0
    for idx, (x, y, w, h) in enumerate(rects):
        if x < 0 or y < 0 or x + w > W or y + h > H:
            bad.append("rect 越界 %s" % ((x, y, w, h),))
            continue
        sub = owner[y:y + h, x:x + w]
        overlap += int(np.count_nonzero(sub != -1))
        sub[:] = idx

    # 3) 图集 / 阴影
    im = Image.open(PNG)
    if im.size != (W, H):
        bad.append("png 尺寸 %s != json %s" % (im.size, (W, H)))
    sh = doc.get("shadow")
    if not sh:
        bad.append("缺 shadow")
    elif sh[2] != 20 or sh[3] != 15:
        bad.append("shadow 尺寸 %s != 20x15" % (sh[2:],))

    print("图集 %d x %d   %.1f KB   VRAM %.1f MB" % (W, H, os.path.getsize(PNG) / 1024, W * H * 4 / 1e6))
    print("clips %d (solid %d / sil %d / animal %d)   frame slots %d   unique rects %d"
          % (len(clips),
             sum(1 for k in clips if not k.endswith("@sil") and not k.startswith("animals")),
             sum(1 for k in clips if k.endswith("@sil")),
             sum(1 for k in clips if k.startswith("animals")),
             sum(c["n"] for c in clips.values()), len(rects)))
    print("checked %d clips; distinct-rect overlap %d px" % (checked, overlap))
    if bad:
        print("\n[FAIL] %d issues:" % len(bad))
        for b in bad[:20]:
            print("   ", b)
        sys.exit(1)
    print("\n[OK] frame count / frame ms / rects all match the decompiled source")


if __name__ == "__main__":
    main()

