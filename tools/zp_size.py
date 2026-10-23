import math
lat0, lat1, lon0, lon1 = 33.0185, 33.0475, 112.2160, 112.2520
ky = 110540; kx = 111320*math.cos(math.radians((lat0+lat1)/2))
print(f"镇平县 bbox 面积: {(lon1-lon0)*kx/1000:.1f} x {(lat1-lat0)*ky/1000:.1f} km "
      f"= {((lon1-lon0)*kx)*((lat1-lat0)*ky)/1e6:.2f} km2")
print(f"中心: {(lat0+lat1)/2:.4f}N, {(lon0+lon1)/2:.4f}E")
