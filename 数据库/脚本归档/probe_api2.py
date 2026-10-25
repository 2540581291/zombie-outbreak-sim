import requests, time
H = {"User-Agent": "ZOS-R personal project (offline simulation)"}
tests = {
 "东京":   "139.7450,35.6750,139.7850,35.7000",
 "郑州":   "113.6400,34.7350,113.6850,34.7650",
 "镇平":   "112.2160,33.0185,112.2520,33.0475",
 "南阳":   "112.5120,32.9800,112.5520,33.0100",
}
for name, b in tests.items():
    t0 = time.time()
    try:
        r = requests.get(f"https://api.openstreetmap.org/api/0.6/map?bbox={b}", headers=H, timeout=180)
        dt = time.time() - t0
        ok = r.status_code == 200
        print(f"{name}  {r.status_code}  {dt:6.1f}s  {len(r.content)/1024/1024:6.1f} MB"
              + ("" if ok else "  ← " + r.text[:110].replace("\n"," ")))
    except Exception as e:
        print(f"{name}  ERR {type(e).__name__} {str(e)[:50]}")
