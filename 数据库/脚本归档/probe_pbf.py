import requests
h = {"User-Agent": "ZOS-R personal project"}
urls = {
 "东京(关东)": "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
 "日本全国": "https://download.geofabrik.de/asia/japan-latest.osm.pbf",
 "中国": "https://download.geofabrik.de/asia/china-latest.osm.pbf",
 "河南": "https://download.geofabrik.de/asia/china/henan-latest.osm.pbf",
}
for name, u in urls.items():
    try:
        r = requests.head(u, headers=h, timeout=30, allow_redirects=True)
        sz = r.headers.get("content-length")
        mb = f"{int(sz)/1024/1024:.0f} MB" if sz else "?"
        print(f"{name:10} {r.status_code}  {mb}")
    except Exception as e:
        print(f"{name:10} ERR {type(e).__name__} {str(e)[:60]}")
