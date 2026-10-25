from PIL import Image, ImageDraw
import os
rows = [("guy01","walk_solid","zwalk01_solid"),("girl01","walk_solid","zwalk01_solid"),("guy02","walk_solid","zwalk01_solid")]
SC=12; cw=15*SC+30; ch=24*SC+40
c=Image.new("RGBA",(cw*2+30,ch*len(rows)+10),(22,24,28,255)); d=ImageDraw.Draw(c)
for i,(t,a1,a2) in enumerate(rows):
    for j,a in enumerate((a1,a2)):
        p=f"reference/sprites/{t}/{a}/00.png"
        if not os.path.exists(p):
            d.text((10+j*cw,10+i*ch+20),f"{t}/{a} 缺失",fill=(200,80,80,255)); continue
        im=Image.open(p).convert("RGBA"); im2=im.resize((im.width*SC,im.height*SC),Image.NEAREST)
        x,y=10+j*cw,10+i*ch+24
        c.alpha_composite(im2,(x,y)); d.text((x,y-14),f"{t}/{a}",fill=(160,200,170,255))
c.save("shots/zwalk_gen.png"); print("写出 shots/zwalk_gen.png")
