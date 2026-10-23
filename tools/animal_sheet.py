from PIL import Image, ImageDraw
import os
names = ["dog","dog_z","cat","cat_z","bear","tiger","tiger_z"]
SC = 8
CW, CH = 16*SC+8, 16*SC+8
c = Image.new("RGBA", (len(names)*(CW+4)+8, 2*(CH+4)+24), (16,18,22,255))
d = ImageDraw.Draw(c)
for i,n in enumerate(names):
    for row,anim in enumerate(["walk_solid","idle01_solid"]):
        p = f"reference/sprites/animals/{n}/{anim}/00.png"
        im = Image.open(p).convert("RGBA").resize((16*SC,16*SC), Image.NEAREST)
        c.alpha_composite(im, (8+i*(CW+4), 20+row*(CH+4)))
    d.text((8+i*(CW+4), 4), n, fill=(150,160,170,255))
c.save("shots/sprites/animals.png")
print("写出 shots/sprites/animals.png", c.size)
