#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载两块航测区的 OSM 数据（先试官方 API，失败退 Overpass）。"""
import os, sys, time, urllib.parse, urllib.request

RAW = os.path.join(os.path.dirname(__file__), '..', 'pipeline', 'raw')
RAW = os.path.abspath(RAW)

TARGETS = {
    'zhenping_town': (33.010967, 112.170410, 33.045508, 112.254181),
    'zhenping_tangying': (32.898615, 112.074280, 32.914180, 112.094879),
}

UA = {'User-Agent': 'ZOS-R city builder (personal project)'}

def fetch(url, timeout=180):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def from_api(minlat, minlon, maxlat, maxlon):
    q = f'{minlon},{minlat},{maxlon},{maxlat}'
    url = f'https://api.openstreetmap.org/api/0.6/map?bbox={q}'
    return fetch(url), url

def from_overpass(minlat, minlon, maxlat, maxlon):
    bbox = f'{minlat},{minlon},{maxlat},{maxlon}'
    q = f'[out:xml][timeout:170];(node({bbox});way({bbox});relation({bbox}););out body;>;out skel qt;'
    url = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q)
    return fetch(url, timeout=200), url

for cid, (minlat, minlon, maxlat, maxlon) in TARGETS.items():
    out = os.path.join(RAW, cid + '.osm')
    if os.path.exists(out) and os.path.getsize(out) > 100_000:
        print(f'{cid}: 已存在 {os.path.getsize(out)/1e6:.1f} MB，跳过')
        continue
    for name, fn in (('API', from_api), ('Overpass', from_overpass)):
        try:
            t0 = time.time()
            data, url = fn(minlat, minlon, maxlat, maxlon)
            if len(data) < 50_000:
                print(f'{cid}: {name} 返回太小（{len(data)} B），换下一个')
                continue
            with open(out, 'wb') as f:
                f.write(data)
            print(f'{cid}: {name} OK  {len(data)/1e6:.1f} MB  {time.time()-t0:.0f}s  -> {out}')
            break
        except Exception as e:
            print(f'{cid}: {name} 失败 -> {type(e).__name__}: {str(e)[:160]}')
    else:
        print(f'{cid}: 两个源都失败')
