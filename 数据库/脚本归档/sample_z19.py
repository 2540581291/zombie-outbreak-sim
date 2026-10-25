# 取一小块 z19 与现有 z18 同区域对比
import math, io, requests
from PIL import Image
lat, lon = 52.5200, 13.4050
def tile(lat, lon, z):
    n = 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1/math.cos(math.radians(lat)))/math.pi)/2*n
    return x, y
h = {"User-Agent": "Mozilla/5.0 (personal project)"}
out = Image.new("RGB", (256*6, 256*5))
for z in (18, 19):
    tx, ty = tile(lat, lon, z)
    x0, y0 = int(tx) - 3, int(ty) - 2
    canvas = Image.new("RGB", (256*6, 256*5))
    for j in range(5):
        for i in range(6):
            u = f"https://mt1.google.com/vt/lyrs=s&x={x0+i}&y={y0+j}&z={z}"
            try:
                r = requests.get(u, headers=h, timeout=25)
                canvas.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), (i*256, j*256))
            except Exception:
                pass
    # 缩放到同样物理范围便于比较：z19 覆盖一半尺度，放大 2 倍后与 z18 同范围
    if z == 19:
        canvas = canvas.resize((canvas.width*2, canvas.height*2), Image.NEAREST)
    canvas = canvas.crop((0, 0, 256*6, 256*5))
    out.paste(canvas.resize((256*6, 256*5), Image.LANCZOS), (0, 0))
    canvas.save(f"shots/sat_z{z}_sample.png")
    print(f"z{z} 样本写出 shots/sat_z{z}_sample.png")
