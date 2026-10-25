import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

# 城市 id
s = s.replace("  const res = await fetch('data/city.json');",
"""  // ---------- 多城市：?city=<id>，默认 berlin ----------
  const CID = (Q.get('city') || 'berlin').replace(/[^a-z0-9_-]/gi, '');
  const CDIR = '数据库/cities/' + CID;
  let cityIndex = [];
  try {
    const ir = await fetch('数据库/cities/index.json');
    if (ir.ok) cityIndex = await ir.json();
  } catch (e) { /* 没有索引就只跑默认城市 */ }

  const res = await fetch(CDIR + '/city.json');""")
s = s.replace("if (!res.ok) { fail('找不到 data/city.json —— 请先运行 pipeline/fetch_city.py'); return; }",
"if (!res.ok) { fail('找不到 ' + CDIR + '/city.json —— 请先运行 pipeline/bake_pbf.py'); return; }")

# 卫星路径
s = s.replace("const tr = await fetch('data/ground/tileset.json');",
"const tr = await fetch(CDIR + '/ground/tileset.json');")
s = s.replace("""      const sr = await fetch('data/sat.json');""",
"""      const sr = await fetch(CDIR + '/sat.json');""")
s = s.replace("""        const tex = await new THREE.TextureLoader().loadAsync('data/' + meta.image);""",
"""        const tex = await new THREE.TextureLoader().loadAsync(CDIR + '/' + meta.image);""")
s = s.replace("      ground = await new TiledGround(scene, city, tileset).load();",
"      tileset.dir = CDIR + '/ground';\n      ground = await new TiledGround(scene, city, tileset).load();")
io.open(p, "w", encoding="utf-8").write(s)
print("main.js 城市路径已参数化")
