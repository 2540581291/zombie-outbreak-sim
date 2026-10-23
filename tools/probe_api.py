import requests, time
H = {"User-Agent": "ZOS-R personal project (offline simulation)"}
# 1) OSM 官方 map API（小 bbox）
b = "112.2300,33.0250,112.2380,33.0310"   # 镇平县城中心 ~0.8x0.7 km
t0 = time.time()
try:
    r = requests.get(f"https://api.openstreetmap.org/api/0.6/map?bbox={b}", headers=H, timeout=60)
    dt = time.time() - t0
    print(f"OSM API  {r.status_code}  {dt:5.1f}s  {len(r.content)/1024:.0f} KB  {len(r.content)/max(dt,0.01)/1024:.0f} KB/s")
    if r.status_code != 200:
        print("   响应:", r.text[:160].replace("\n", " "))
except Exception as e:
    print("OSM API ERR", type(e).__name__, str(e)[:60])

# 2) 备用 Overpass
Q = "[out:json][timeout:60];way[\"building\"](33.0250,112.2300,33.0310,112.2380);out geom;"
for ep in ["https://overpass.osm.ch/api/interpreter",
           "https://overpass.openstreetmap.ru/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]:
    t0 = time.time()
    try:
        r = requests.post(ep, data={"data": Q}, headers=H, timeout=45)
        dt = time.time() - t0
        n = len(r.json().get("elements", [])) if r.status_code == 200 else -1
        print(f"{ep.split('/')[2]:26} {r.status_code} {dt:5.1f}s {len(r.content)/1024:6.0f} KB  {n} 元素")
    except Exception as e:
        print(f"{ep.split('/')[2]:26} ERR {type(e).__name__}")
