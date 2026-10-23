import math, io, requests, numpy as np
from PIL import Image
lat, lon = 52.5200, 13.4050
def t(lat, lon, z):
    n = 2**z
    return ((lon+180)/360*n, (1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n)
h = {"User-Agent": "Mozilla/5.0 (personal project)"}
SRC = [
 ("Google  z19", "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", 19),
 ("Esri    z19", "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", 19),
 ("Esri    z18", "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", 18),
]
res = []
for name, tpl, z in SRC:
    x, y = t(lat, lon, z); x0, y0 = int(x)-1, int(y)-1
    canvas = Image.new("RGB", (512, 512))
    ok = 0
    for j in range(2):
        for i in range(2):
            u = tpl.format(x=x0+i, y=y0+j, z=z)
            try:
                r = requests.get(u, headers=h, timeout=25)
                if r.status_code == 200:
                    canvas.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), (i*256, j*256)); ok += 1
            except Exception: pass
    a = np.asarray(canvas.convert("L"), dtype=np.float32)
    lap = np.abs(np.diff(a, axis=0)[:, :-1]) + np.abs(np.diff(a, axis=1)[:-1, :])
    res.append((name, ok, float(lap.mean()), canvas))
    canvas.save("shots/src_" + name.split()[0].lower() + str(z) + ".png")
for name, ok, sharp, _ in res:
    print(f"{name}  瓦片 {ok}/4   锐度(梯度均值) {sharp:5.2f}")
best = max(res, key=lambda r: r[2])
print("\n最锐:", best[0])
