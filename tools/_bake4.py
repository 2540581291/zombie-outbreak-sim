import sys, io, json, time, base64, zlib
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, "pipeline")
import collision
from PIL import Image

COLOR = {0x00:(220,40,40),0x03:(190,190,190),0x07:(60,170,60),0x0f:(40,230,90),
         0x16:(40,220,220),0x1f:(255,140,20),0x42:(240,200,40),0x43:(150,255,120),0x82:(30,80,220)}

def render(g, W, H, cell, out, win_m=120, zoom=4):
    hw, hh = int(win_m/2/cell), int(win_m/2/cell*2/3)
    cx, cy = W//2, H//2
    img = Image.new("RGB", (hw*2, hh*2)); px = img.load()
    for y in range(hh*2):
        for x in range(hw*2):
            px[x,y] = COLOR.get(g[(cy-hh+y)*W + (cx-hw+x)], (255,0,255))
    img = img.resize(((hw*2)*zoom, (hh*2)*zoom), Image.NEAREST)
    img.save(out); print("  ->", out, img.size, flush=True)

city = json.load(io.open("data/cities/berlin/city.json", encoding="utf-8"))
# ① 1m：直接用现有数据
c = city["collision"]
g1 = zlib.decompress(base64.b64decode(c["b64"]))
render(g1, c["cols"], c["rows"], c["cell"], "shots/bake_1_0.png", 120, 4)
print(f"1m: {c['cols']}x{c['rows']} cell={c['cell']}", flush=True)
# ② 0.4m：重烘
t0 = time.time()
col = collision.build(city, cell=0.4, verbose=False)
print(f"0.4m: {col['cols']}x{col['rows']} = {col['cols']*col['rows']/1e6:.2f}M 格, 烘 {time.time()-t0:.1f}s", flush=True)
render(col["raw"], col["cols"], col["rows"], 0.4, "shots/bake_0_4.png", 120, 10)
print("DONE", flush=True)
