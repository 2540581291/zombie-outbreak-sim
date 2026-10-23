import sys; sys.path.insert(0,"pipeline")
import numpy as np, glob, os
from PIL import Image, ImageDraw
from upscale_sprites import load_frame, recolor, classify_colors

def dilate(mask, r=1):
    m = mask
    for _ in range(r):
        m = np.maximum.reduce([m, np.roll(m,1,0), np.roll(m,-1,0), np.roll(m,1,1), np.roll(m,-1,1)])
    return m
def hd(im, S=8, ring=2, outline=(0.05,0.05,0.06)):
    w,h = im.size; W,H = w*S, h*S
    base = im.resize((W,H), Image.NEAREST)
    a = np.array(base, dtype=np.float32)/255.0
    al = Image.fromarray((np.array(im)[...,3]).astype(np.uint8), "L").resize((W,H), Image.BICUBIC)
    ah = np.clip((np.array(al,dtype=np.float32)/255.0-0.35)/0.30, 0, 1)
    mask = ah > 0.5; ringm = dilate(mask, ring) & ~mask
    out = np.zeros((H,W,4), np.float32)
    out[...,:3] = np.array(outline, np.float32); out[...,3][ringm] = 1.0
    out[...,:3][mask] = a[...,:3][mask]; out[...,3][mask] = 1.0
    return Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8), "RGBA")

HUES = [0.0, 0.07, 0.15, 0.28, 0.42, 0.55, 0.70, 0.85]
CELL = 15*6
rows=[]
for t in ["guy01","police01","girl01","fat01"]:
    fs = sorted(glob.glob(f"reference/sprites/{t}/walk_solid/*.png"))[:3]
    for hue in HUES:
        for f in fs:
            im = load_frame(f)
            v = recolor(im, hue_shift=hue, sat_mul=1.0, light_mul=1.0,
                        skin_shift=0.0, skin_light=1.0) if hue else im
            rows.append((t, hue, hd(v, 6)))
CW = CELL*6+16; CH = CELL*6+16
W = CW*3+80; H = CH*len(rows)//3+30
c = Image.new("RGBA",(W,H),(16,18,22,255)); d=ImageDraw.Draw(c)
y0=26
for i,(t,hue,img) in enumerate(rows):
    row = i//3; col = i%3
    x = 80+col*CW; y = y0+row*CH
    if col==0: d.text((6,y+CH//2),f"{t} hue+{int(hue*360)}",fill=(110,120,130,255))
    c.alpha_composite(img,(x,y))
c.save("shots/sprites/variant_test.png")
print("写出 shots/sprites/variant_test.png", c.size)
