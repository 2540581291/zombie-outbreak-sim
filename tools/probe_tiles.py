import requests, math
# 柏林中心
lat, lon, z = 52.5200, 13.4050, 19
n = 2 ** z
x = int((lon + 180) / 360 * n)
y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
print(f"z={z} tile x={x} y={y}")
SRC = {
 "Google s ": f"https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
 "Esri z19 ": f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
 "Esri z20 ": f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/20/{int(y*2)}/{int(x*2)}",
 "OSM      ": f"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
}
h = {"User-Agent": "Mozilla/5.0 (personal project)"}
for name, u in SRC.items():
    try:
        r = requests.get(u, headers=h, timeout=25)
        print(f"{name} {r.status_code}  {len(r.content)/1024:.0f} KB  {r.headers.get('content-type','')[:24]}")
    except Exception as e:
        print(f"{name} ERR {type(e).__name__} {str(e)[:50]}")
