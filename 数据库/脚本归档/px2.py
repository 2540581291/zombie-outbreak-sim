from PIL import Image
im = Image.open("shots/sat2.png").convert("RGB"); px = im.load(); w,h = im.size
print("size", im.size, "samples", [px[int(w*.3),int(h*.55)], px[int(w*.5),int(h*.75)], px[int(w*.6),int(h*.4)]])
g = im.convert("L").histogram(); tot=w*h
print("lights:", [(f"{a}-{b}", round(sum(g[a:b])*100/tot,1)) for a,b in [(0,12),(12,40),(40,90),(90,180),(180,255)]])
