import json, math
city = json.load(open("data/city.json", encoding="utf-8"))
sat = json.load(open("data/sat.json", encoding="utf-8"))
lon0, lat0 = city["origin"]; kx = 111320*math.cos(math.radians(lat0)); ky = 110540
W, H = city["size"]
satW, satS, satE, satN = sat["bounds"]
satMw = (satE-satW)*kx; satMh = (satN-satS)*ky
sw, sh = sat["size"]
print("城市      %.0f x %.0f m   (%.2f km2)" % (W, H, W*H/1e6))
print("卫星覆盖  %.0f x %.0f m   (%.2f km2)" % (satMw, satMh, satMw*satMh/1e6))
print("多出      %.0f m 宽 / %.0f m 高  = %.1f%% 面积" % (satMw-W, satMh-H, (satMw*satMh)/(W*H)*100-100))
print("图像      %dx%d px  → %.3f m/px" % (sw, sh, satMw/sw))
print("城市 bbox", city["bbox"])
print("卫星 bbox", sat["bounds"])
