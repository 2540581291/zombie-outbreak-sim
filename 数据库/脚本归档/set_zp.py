import io
p = "tools/cities.py"
s = io.open(p, encoding="utf-8").read()
old_start = s.index(' "nanyang":')
old_end = s.index('}', old_start) + 1
new = ''' "zhenping":  dict(name="南阳 镇平县", pbf="china.osm.pbf",
                   minlat=33.0185, minlon=112.2160, maxlat=33.0475, maxlon=112.2520, zoom=19),'''
s = s[:old_start] + new + s[old_end:]
io.open(p, "w", encoding="utf-8").write(s)
print("已改为 镇平县")
