import io
# 1) split_sat.py 增加缩略图
p = "pipeline/split_sat.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('''    print(f"\\n{cols}x{rows} = {cols*rows} 块''',
'''    # 远景缩略图（长边 8192，约 52 MP，远景只画这一张）
    maxside = 8192
    k = min(1.0, maxside / max(W, H))
    if k < 1.0:
        ov = im.resize((int(W * k), int(H * k)), Image.LANCZOS)
    else:
        ov = im
    ov.save(os.path.join(args.outdir, "overview.jpg"), "JPEG", quality=86, optimize=True)
    print(f"  缩略图 {ov.size[0]}x{ov.size[1]}  {os.path.getsize(os.path.join(args.outdir,'overview.jpg'))/1024/1024:.0f} MB")

    print(f"\\n{cols}x{rows} = {cols*rows} 块''')
io.open(p, "w", encoding="utf-8").write(s)

# 2) main.js 接分块地面
p2 = "js/main.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("import { buildCity, buildSatelliteGround } from './city.js';",
"import { buildCity, buildSatelliteGround } from './city.js';\nimport { TiledGround } from './ground.js';")
s2 = s2.replace("let satMesh = null;", "let satMesh = null, ground = null;")
s2 = s2.replace("""  try {
    const sr = await fetch('data/sat.json');
    if (sr.ok) {
      const meta = await sr.json();
      const tex = await new THREE.TextureLoader().loadAsync('data/' + meta.image);
      satMesh = buildSatelliteGround(city, meta, tex);
      scene.add(satMesh);
    }
  } catch (e) {
    console.warn('卫星影像不可用，回退矢量地图：', e);
  }""",
"""  try {
    const tr = await fetch('data/ground/tileset.json');
    if (tr.ok) {
      const tileset = await tr.json();
      ground = await new TiledGround(scene, city, tileset).load();
      satMesh = ground;                       // 沿用旧的开关逻辑
      console.log('[ZOS-R] 分块地面 ' + tileset.cols + 'x' + tileset.rows +
        ' 每块 ' + tileset.tileSize + 'px');
    } else {
      // 没有分块就退回单张图
      const sr = await fetch('data/sat.json');
      if (sr.ok) {
        const meta = await sr.json();
        const tex = await new THREE.TextureLoader().loadAsync('data/' + meta.image);
        satMesh = buildSatelliteGround(city, meta, tex);
        scene.add(satMesh);
      }
    }
  } catch (e) {
    console.warn('卫星影像不可用，回退矢量地图：', e);
  }""")
s2 = s2.replace("  sky.position.copy(camera.position);",
"""  if (ground) {
    ground.update({ cx: rig.target.x, cz: rig.target.z, dist: rig.dist,
      halfW: Math.max(60, rig.dist * 0.9), halfH: Math.max(60, rig.dist * 0.9) });
  }
  sky.position.copy(camera.position);""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("patched")
