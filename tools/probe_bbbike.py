import requests, time
H = {"User-Agent": "ZOS-R personal project"}
# 先看目录里有哪些城市
try:
    r = requests.get("https://download.bbbike.org/osm/bbbike/", headers=H, timeout=30)
    names = [x for x in r.text.split('"') if x.endswith(".osm.pbf")]
    hit = [n for n in names if any(k in n for k in ("Tokyo","Zhengzhou","Nanyang","China","Osaka","Seoul"))]
    print("BBBike 命中:", hit)
    print("总城市数:", len(names))
except Exception as e:
    print("目录读取失败:", type(e).__name__)
# 测速
for name in ("Tokyo",):
    u = f"https://download.bbbike.org/osm/bbbike/{name}/{name}.osm.pbf"
    hh = dict(H); hh["Range"] = "bytes=0-4000000"
    t0 = time.time(); got = 0
    try:
        r = requests.get(u, headers=hh, stream=True, timeout=(15, 60))
        for ch in r.iter_content(1 << 16):
            got += len(ch)
            if time.time() - t0 > 8: break
        print(f"{name}: {got/1024/1024:.1f} MB / {time.time()-t0:.1f}s = {got/1024/(time.time()-t0):.0f} KB/s  HTTP {r.status_code}")
    except Exception as e:
        print(f"{name}: ERR {type(e).__name__}")
