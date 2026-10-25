import io
p = "tools/cities.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('pbf="china.osm.pbf",\n        minlat=34.7350', 'pbf="china.osm.pbf", cut="henan.osm.pbf",\n        minlat=34.7350')
s = s.replace('pbf="china.osm.pbf",\n        minlat=32.9800', 'pbf="china.osm.pbf", cut="henan.osm.pbf",\n        minlat=32.9800')
s = s.replace('pbf="china.osm.pbf",\n        minlat=33.0185', 'pbf="china.osm.pbf", cut="henan.osm.pbf",\n        minlat=33.0185')
io.open(p, "w", encoding="utf-8").write(s)
print("三个河南城市已指向 henan 切片")
