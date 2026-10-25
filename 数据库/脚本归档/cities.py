#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""城市定义：bbox 是地图覆盖范围（同柏林约 3×3 km 的城市核心区）。

换城市时改这里，然后 python tools/build_city.py <id>
PBF 需事先放在 pipeline/raw/（见 pbf 字段）。
"""

CITIES = {
    "tokyo": dict(
        name="东京 新宿·千代田",
        pbf="kanto.osm.pbf",
        minlat=35.6750, minlon=139.7450,
        maxlat=35.7000, maxlon=139.7850,
        zoom=19,
    ),
    "zhengzhou": dict(
        name="郑州 二七区",
        pbf="china.osm.pbf", cut="henan.osm.pbf",
        minlat=34.7350, minlon=113.6400,
        maxlat=34.7650, maxlon=113.6850,
        zoom=19,
    ),
    "nanyang": dict(
        name="南阳 卧龙区",
        pbf="china.osm.pbf", cut="henan.osm.pbf",
        minlat=32.9800, minlon=112.5120,
        maxlat=33.0100, maxlon=112.5520,
        zoom=19,
    ),
    "zhenping": dict(
        name="南阳 镇平县",
        pbf="china.osm.pbf", cut="henan.osm.pbf",
        minlat=33.0185, minlon=112.2160,
        maxlat=33.0475, maxlon=112.2520,
        zoom=19,
    ),
}
