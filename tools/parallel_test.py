import requests, time, threading
URL = "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf"
H = {"User-Agent": "ZOS-R personal project"}
N = 8
got = [0]*N
stop = False
def worker(i):
    # 每路取不同的 8MB 区段，避免重叠
    start = i * (8 << 20)
    h = dict(H); h["Range"] = f"bytes={start}-{start + (8<<20) - 1}"
    try:
        with requests.get(URL, headers=h, stream=True, timeout=(15, 60)) as r:
            if r.status_code != 206:
                print(f"  连接{i}: HTTP {r.status_code}"); return
            for ch in r.iter_content(1 << 16):
                got[i] += len(ch)
                if stop: break
    except Exception as e:
        print(f"  连接{i}: {type(e).__name__}")
t0 = time.time()
ths = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
for t in ths: t.start()
time.sleep(10)
stop = True
for t in ths: t.join(timeout=15)
dt = time.time() - t0
tot = sum(got)
print(f"{N} 路并发：{tot/1024/1024:.2f} MB / {dt:.1f}s = {tot/1024/dt:.0f} KB/s  单路 {tot/1024/dt/N:.0f} KB/s")
