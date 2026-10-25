import requests, time
H = {"User-Agent": "ZOS-R personal project", "Range": "bytes=0-4000000"}
tests = {
 "geofabrik": "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
 "osmfr":     "https://download.openstreetmap.fr/extracts/asia/japan/kanto-latest.osm.pbf",
}
for n, u in tests.items():
    t0 = time.time()
    try:
        r = requests.get(u, headers=H, stream=True, timeout=(15, 60))
        got = 0
        for ch in r.iter_content(1 << 16):
            got += len(ch)
            if time.time() - t0 > 8: break
        dt = time.time() - t0
        print(f"{n:10} {got/1024/1024:.1f} MB / {dt:.1f}s = {got/1024/dt:.0f} KB/s  HTTP {r.status_code}")
    except Exception as e:
        print(f"{n:10} ERR {type(e).__name__} {str(e)[:40]}")
