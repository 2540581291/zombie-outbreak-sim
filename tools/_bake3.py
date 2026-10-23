import sys, io, json, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, "pipeline")
import collision
from PIL import Image

city = json.load(io.open("data/cities/berlin/city.json", encoding="utf-8"))
COLOR = {0x00: (220,40,40), 0x03: (190,190,190), 0x07: (60,170,60),
         0x0f: (40,230,90), 0x16: (40,220,220), 0x1f: (255,140,20),
         0x42: (240,200,40), 0x43: (150,255,120), 0x82: (30,80,220)}
for cell in (1.0, 0.4):
    t0 = time.time()
    col = collision.build(city, cell=cell, verbose=False)
    dt = time.time() - t0
    n = col["cols"] * col["rows"]
    print(f"cell={cell}: {col['cols']}x{col['rows']} = {n/1e6:.2f}M 格, 烘 {dt:.1f}s, 网格 {n/1048576:.1f}MB", flush=True)
    key = "grid" if "grid" in col else ("data" if "data" in col else None)
    print("  keys:", list(col.keys()), flush=True)
    if not key: continue
    g = col[key]
    W = col["cols"]; H = col["rows"]
    hw, hh = int(60/cell), int(40/cell)
    cx, cy = W//2, H//2
    img = Image.new("RGB", (hw*2, hh*2)); px = img.load()
    for y in range(hh*2):
        for x in range(hw*2):
            px[x, y] = COLOR.get(g[(cy-hh+y)*W + (cx-hw+x)], (255,0,255))
    k = 4 if cell == 1.0 else 10
    img = img.resize((hw*2*k//2, hh*2*k//2), Image.NEAREST)
    out = f"shots/bake_{str(cell).replace('.','_')}.png"
    img.save(out); print("   ->", out, img.size, flush=True)
print("DONE", flush=True)
