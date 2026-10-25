import sys, os
sys.path.insert(0, "pipeline")
import numpy as np
from PIL import Image, ImageDraw
from upscale_sprites import load_frame, upscale_epx, recolor, classify_colors

def dilate(mask, r=1):
    m = mask
    for _ in range(r):
        m = np.maximum.reduce([m,
            np.roll(m,1,0), np.roll(m,-1,0), np.roll(m,1,1), np.roll(m,-1,1)])
    return m

def hd(im, S=8, outline=(0.05,0.05,0.06), ring=2):
    """高清重制：内部硬像素 + 外轮廓抗锯齿 + 一圈描边（贴纸感）"""
    w,h = im.size
    W,H = w*S, h*S
    # 内部：最近邻，保住平涂
    base = im.resize((W,H), Image.NEAREST)
    a = np.array(base, dtype=np.float32)/255.0
    # alpha：双三次放大后取平滑，只影响轮廓
    al = Image.fromarray((np.array(im)[...,3]).astype(np.uint8), "L").resize((W,H), Image.BICUBIC)
    ah = np.array(al, dtype=np.float32)/255.0
    ah = np.clip((ah-0.35)/0.30, 0, 1)          # 软边
    mask = ah > 0.5
    # 外描边
    ringm = dilate(mask, ring) & ~mask
    col = a[...,:3]
    # 描边颜色
    out = np.concatenate([np.broadcast_to(np.array(outline,dtype=np.float32),(H,W,3)), np.zeros((H,W,1),np.float32)], axis=-1)
    out[...,3][ringm] = 1.0
    # 贴上层
    inside = mask
    out[...,:3][inside] = col[inside]
    out[...,3][inside] = 1.0
    # 轮廓内侧压暗一点，增加体积感
    edge = (dilate(mask,1) & ~mask)
    return Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8), "RGBA")

frames = []
for t in ["guy01","police01","girl01","fat01"]:
    import glob
    fs = sorted(glob.glob(f"reference/sprites/{t}/walk_solid/*.png"))[:4]
    frames += [(t, f) for f in fs]

S=8
cells=[]
for t,f in frames:
    im = load_frame(f)
    cells.append((t, hd(im,S), upscale_epx(im,3), im.resize((im.width*S,im.height*S), Image.NEAREST)))

CW = max(c[1].width for c in cells)+16
CH = max(c[1].height for c in cells)+16
W = CW*3+90
H = CH*len(cells)+28
c = Image.new("RGBA",(W,H),(16,18,22,255)); d=ImageDraw.Draw(c)
d.text((90,8),"nearest ×8",fill=(150,160,170,255))
d.text((90+CW,8),"epx ×8",fill=(150,160,170,255))
d.text((90+CW*2,8),"HD 重制 ×8",fill=(255,180,120,255))
y=26
for t,a,b,e in cells:
    d.text((6,y+CH//2),t,fill=(110,120,130,255))
    c.alpha_composite(e,(90,y)); c.alpha_composite(b,(90+CW,y)); c.alpha_composite(a,(90+CW*2,y))
    y+=CH
c.save("shots/sprites/hd_compare.png")
print("写出 shots/sprites/hd_compare.png", c.size)
