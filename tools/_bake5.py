import sys, io, json, time, base64, zlib
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, "pipeline")
import collision
from PIL import Image
COLOR = {0x00:(220,40,40),0x03:(190,190,190),0x07:(60,170,60),0x0f:(40,230,90),
         0x16:(40,220,220),0x1f:(255,140,20),0x42:(240,200,40),0x43:(150,255,120),0x82:(30,80,220)}
city = json.load(io.open("data/cities/berlin/city.json", encoding="utf-8"))
t0 = time.time()
col = collision.build(city, cell=0.4, verbose=False)
print(f"0.4m: {col['cols']}x{col['rows']} = {col['cols']*col['rows']/1e6:.2f}M, {time.time()-t0:.0f}s, b64 {len(col['b64'])/1024:.0f}KB", flush=True)
g = zlib.decompress(base64.b64decode(col["b64"]))
W, H, cell = col["cols"], col["rows"], 0.4
hw, hh = int(60/cell), int(40/cell)
cx, cy = W//2, H//2
img = Image.new("RGB", (hw*2, hh*2)); px = img.load()
for y in range(hh*2):
    for x in range(hw*2):
        px[x,y] = COLOR.get(g[(cy-hh+y)*W + (cx-hw+x)], (255,0,255))
img = img.resize(((hw*2)*3, (hh*2)*3), Image.NEAREST)
img.save("shots/bake_0_4.png")
print("->", img.size, flush=True)
