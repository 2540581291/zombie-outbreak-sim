import requests
H = {"User-Agent": "ZOS-R personal project"}
tests = {
 "primary":  "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
 "nluug":    "https://ftp.nluug.nl/pub/metalab/mirrors/geofabrik/asia/japan/kanto-latest.osm.pbf",
 "osmfr":    "https://download.openstreetmap.fr/extracts/asia/japan/kanto-latest.osm.pbf",
 "china-nl": "https://ftp.nluug.nl/pub/metalab/mirrors/geofabrik/asia/china-latest.osm.pbf",
}
for n, u in tests.items():
    try:
        r = requests.head(u, headers=H, timeout=20, allow_redirects=True)
        sz = r.headers.get("content-length")
        print(f"{n:10} {r.status_code}  {int(sz)/1024/1024:.0f} MB" if sz else f"{n:10} {r.status_code}")
    except Exception as e:
        print(f"{n:10} ERR {type(e).__name__}")
