# -*- coding: utf-8 -*-
"""
从 reference/core（反编译出来的 2009 原版）重建精灵图集 v2。
这是**唯一权威**的构建脚本：原来的 build_retro_atlas*.py / export_hd.py /
upscale_sprites.py 全部作废。

    python tools/build_atlas.py

产出：
    assets/atlas/atlas.png    变量矩形密排，1:1 原像素
    assets/atlas/atlas.json   clip 表（n / ms / loop / frames）

关键点（都是踩过的坑）：
  * 帧序必须走动画类的 _ir761() switch —— 不能用导出的文件名排序（会乱）；
  * 像素必须走帧类里的 [Embed(source="/_assets/…")] —— SWF 里被多支动画共用
    的帧是裸 "/_assets/123.png"，按“符号名”去硬盘上找会漏（这就是旧图集
    39/68 支动画帧数偏少的根因）；
  * 帧数/帧长/循环一律取 _qk83() / _br451() / _wc1144()，和展开出的帧数对不上
    就 exit 1，绝不产出“差不多”的图集；
  * 剪影（_yc249）烘成白色，颜色留给运行时按阵营 tint。
"""
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import glob
import json

from PIL import Image

CORE = "reference/core"
AS = os.path.join(CORE, "scripts/src/animationfactory")
IMG = os.path.join(CORE, "images")
ANIMALS = os.path.join("reference", "sprites", "animals")
OUT_DIR = os.path.join("assets", "atlas")
OUT_PNG = os.path.join(OUT_DIR, "atlas.png")
OUT_JSON = os.path.join(OUT_DIR, "atlas.json")

TYPES = ["guy01", "guy02", "girl01", "girl02", "fat01", "police01"]
ANIMS = ["walk", "idle01", "idle02", "run01", "shoot01", "die01",
         "turn01", "zrise01", "zwalk01", "zwalk02", "zattack01", "zdie01"]

# 原版里 police01 没有自己的僵尸走/咬/倒，_vf423.as 直接把 guy01 的对象赋过去
REUSE = {("police01", "zwalk01"): ("guy01", "zwalk01"),
         ("police01", "zwalk02"): ("guy01", "zwalk02"),
         ("police01", "zattack01"): ("guy01", "zattack01"),
         ("police01", "zdie01"): ("guy01", "zdie01")}

ANIMAL_GROUPS = ["dog", "cat", "bear", "tiger"]
ANIMAL_MS = 150

PAD = 1
ATLAS_W = 2048


# ------------------------------------------------------------------ 解析
def _read(path):
    return open(path, encoding="utf-8", errors="replace").read()


def meta(path, fn):
    m = re.search(r"function %s\(\)\s*:\s*\w+\s*\{\s*return ([^;]+);" % fn, _read(path))
    return m.group(1).strip() if m else None


def frame_ids(path):
    pairs = re.findall(r"case (\d+):\s*return (_\w+);", _read(path))
    return [n for _, n in sorted(pairs, key=lambda p: int(p[0]))]


def frame_file(typ, anim, sym, name):
    cls = os.path.join(AS, typ, anim, "%s__%s.as" % (sym, name.lstrip("_")))
    if os.path.exists(cls):
        m = re.search(r'Embed\(source="/_assets/([^"]+)"\)', _read(cls))
        if m:
            p = os.path.join(IMG, m.group(1))
            if os.path.exists(p):
                return p
    g = glob.glob(os.path.join(IMG, "*%s.%s.%s__%s.png" % (typ, anim, sym, name.lstrip("_"))))
    return g[0] if g else None


def load_frames(typ, anim, sym):
    """→ [(Image RGBA, 原文件路径)]，顺序 = 真实播放顺序。"""
    cls = os.path.join(AS, typ, anim, sym + ".as")
    if not os.path.exists(cls):
        return None, None
    out = []
    for name in frame_ids(cls):
        f = frame_file(typ, anim, sym, name)
        if not f:
            raise SystemExit("MISSING frame %s/%s/%s/%s" % (typ, anim, sym, name))
        out.append((Image.open(f).convert("RGBA"), f))
    return out, cls


def whiten(im):
    """剪影：RGB 压成白，alpha 不动（颜色运行时 tint）。"""
    a = im.getchannel("A")
    w = Image.new("RGBA", im.size, (255, 255, 255, 0))
    w.putalpha(a)
    return w


# ------------------------------------------------------------------ 打包
class Shelf:
    def __init__(self, width, pad):
        self.w = width
        self.pad = pad
        self.x = 0
        self.y = 0
        self.row_h = 0
        self.placed = []          # (x, y, w, h)

    def add(self, w, h):
        if w + self.pad > self.w:
            raise SystemExit("frame %dx%d 比图集宽度还宽" % (w, h))
        if self.x + w + self.pad > self.w:
            self.x = 0
            self.y += self.row_h + self.pad
            self.row_h = 0
        x, y = self.x, self.y
        self.x += w + self.pad
        self.row_h = max(self.row_h, h)
        return x, y

    @property
    def height(self):
        return self.y + self.row_h + self.pad


def main():
    # 1) 收集所有帧（先按高度降序排，货架打包才不浪费）
    items = []                 # (w, h, kind, payload)
    clips = {}                 # key -> {n, ms, loop, rects: [...]}
    seen_px = {}               # (path, whiten) -> (w,h) 校验用
    report = []

    def add_clip(key, ms, loop, frames, white):
        imgs = [whiten(im) if white else im for im, _ in frames]
        sizes = {im.size for im in imgs}
        if len(sizes) != 1:
            raise SystemExit("%s 帧尺寸不一致: %s" % (key, sorted(sizes)))
        w, h = imgs[0].size
        clip = {"n": len(imgs), "ms": ms, "loop": loop, "frames": [None] * len(imgs)}
        clips[key] = clip
        for i, (im, src) in enumerate(frames):
            if white:
                im = whiten(im)
            items.append((w, h, key, i, im, src, white))
        report.append((key, len(imgs), ms, w, h))

    for typ in TYPES:
        for anim in ANIMS:
            src_t, src_a = REUSE.get((typ, anim), (typ, anim))
            for sym, suffix, white in (("_sj1166", "", False), ("_yc249", "@sil", True)):
                frames, cls = load_frames(src_t, src_a, sym)
                if frames is None:
                    continue
                n_decl = int(meta(cls, "_qk83"))
                ms = int(meta(cls, "_br451"))
                loop = meta(cls, "_wc1144") == "true"
                if len(frames) != n_decl:
                    raise SystemExit(
                        "%s/%s%s: 展开 %d 帧，_qk83() 声明 %d 帧" %
                        (src_t, src_a, suffix, len(frames), n_decl))
                add_clip("%s/%s%s" % (typ, anim, suffix), ms, loop, frames, white)

    # 2) 动物（程序化生成的，不走反编译；但走同一套 clip 规格）
    for g in ANIMAL_GROUPS:
        for zw in ("", "_z"):
            name = "animals_%s%s" % (g, zw)
            for anim, sub in (("walk", "walk_solid"), ("idle01", "idle01_solid")):
                d = os.path.join(ANIMALS, "%s%s" % (g, zw), sub)
                files = sorted(glob.glob(os.path.join(d, "*.png")))
                if not files:
                    continue
                frames = [(Image.open(f).convert("RGBA"), f) for f in files]
                add_clip("%s/%s" % (name, anim), ANIMAL_MS, True, frames, False)

    # 3) 打包（同一张源图只放一次：turn01 这样的动画有大量重复帧）
    items.sort(key=lambda it: (-it[1], -it[0]))
    shelf = Shelf(ATLAS_W, PAD)
    uniq = {}
    placed_items = []
    for w, h, key, i, im, src, white in items:
        k = (src, white)
        if k in uniq:
            clips[key]["frames"][i] = list(uniq[k])
            continue
        x, y = shelf.add(w, h)
        uniq[k] = [x, y, w, h]
        clips[key]["frames"][i] = [x, y, w, h]
        placed_items.append((im, x, y))

    H = (shelf.height + 3) // 4 * 4          # NPOT 高度，WebGL2 完全没问题

    atlas = Image.new("RGBA", (ATLAS_W, H), (0, 0, 0, 0))
    for im, x, y in placed_items:
        atlas.alpha_composite(im, (x, y))

    # 4) 阴影贴图（原版 _dw934__vt862：20×15 软黑椭圆）
    sh = glob.glob(os.path.join(IMG, "*_dw934__vt862.png"))
    if not sh:
        raise SystemExit("找不到阴影贴图 _dw934__vt862.png")
    shadow = Image.open(sh[0]).convert("RGBA")
    sx, sy = shelf.add(shadow.width, shadow.height)
    atlas.alpha_composite(shadow, (sx, sy))

    # 5) 写盘
    os.makedirs(OUT_DIR, exist_ok=True)
    atlas.save(OUT_PNG, optimize=True)
    doc = {
        "v": 2,
        "w": ATLAS_W,
        "h": H,
        "variants": 1,
        "shadow": [sx, sy, shadow.width, shadow.height],
        "clips": clips,
        "stats": {
            "clips": len(clips),
            "frames": len(items),
            "png_bytes": os.path.getsize(OUT_PNG),
        },
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))

    # 6) 报告
    print("=" * 62)
    print("clips %d   frames %d   图集 %d×%d   PNG %.1f KB   显存 %.1f MB"
          % (len(clips), len(items), ATLAS_W, H,
             os.path.getsize(OUT_PNG) / 1024, ATLAS_W * H * 4 / 1e6))
    print("=" * 62)
    for key, n, ms, w, h in report:
        if key.endswith("@sil"):
            continue
        print("  %-22s %3d 帧 × %3d ms = %5.2f s   %dx%d" % (key, n, ms, n * ms / 1000, w, h))
    print("  剪影 %d 支；动物 %d 支"
          % (sum(1 for k in clips if k.endswith("@sil")),
             sum(1 for k in clips if k.startswith("animals_"))))


if __name__ == "__main__":
    main()

