from PIL import Image, ImageDraw
import numpy as np
def show(path, scale=24):
    im = Image.open(path).convert("RGBA")
    w,h = im.size
    big = im.resize((w*scale, h*scale), Image.NEAREST)
    c = Image.new("RGBA", (big.width+2, big.height+2), (16,18,22,255))
    c.alpha_composite(big,(1,1))
    d = ImageDraw.Draw(c)
    for x in range(w+1):
        d.line([(x*scale,x*0+1),(x*scale,big.height+1)], fill=(40,44,50,255))
    for y in range(h+1):
        d.line([(1,y*scale),(big.width+1,y*scale)], fill=(40,44,50,255))
    return c
for p,tag in [("reference/sprites/guy01/walk_solid/00.png","guy_walk0"),
              ("reference/sprites/police01/walk_solid/00.png","police_walk0"),
              ("reference/sprites/guy01/zattack01_solid/00.png","guy_attack0")]:
    show(p).save(f"shots/sprites/zoom_{tag}.png")
    print("写出", f"shots/sprites/zoom_{tag}.png", Image.open(p).size)
