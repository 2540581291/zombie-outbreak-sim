import requests, time
H = {"User-Agent": "ZOS-R personal project (contact: local)"}
Q = """[out:json][timeout:90];
(
  way["building"](35.6780,139.7460,35.6810,139.7500);
  way["highway"](35.6780,139.7460,35.6810,139.7500);
);
out geom;"""
eps = ["https://overpass-api.de/api/interpreter",
       "https://overpass.kumi.systems/api/interpreter",
       "https://overpass.private.coffee/api/interpreter"]
for ep in eps:
    t0 = time.time()
    try:
        r = requests.post(ep, data={"data": Q}, headers=H, timeout=90)
        dt = time.time() - t0
        n = len(r.json().get("elements", [])) if r.status_code == 200 else 0
        print(f"{ep.split('/')[2]:32} {r.status_code}  {dt:5.1f}s  {len(r.content)/1024:.0f} KB  {n} 元素")
    except Exception as e:
        print(f"{ep.split('/')[2]:32} ERR {type(e).__name__} {str(e)[:40]}")
