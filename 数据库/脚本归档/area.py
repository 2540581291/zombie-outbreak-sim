import math
from cities import CITIES
print()
for k, c in CITIES.items():
    kx = 111320 * math.cos(math.radians((c["minlat"]+c["maxlat"])/2))
    w = (c["maxlon"]-c["minlon"]) * kx / 1000
    h = (c["maxlat"]-c["minlat"]) * 110540 / 1000
    print(f"  {c['name']:16} {w:.1f} x {h:.1f} km = {w*h:.2f} km2")
