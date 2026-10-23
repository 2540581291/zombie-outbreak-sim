import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

old = "  renderer.render(scene, camera);"
new = '''  if (retroMode && retro && retro.ready) {
    // ---- 2009 复古模式：正交俯视 + 精灵 ----
    const halfH = Math.max(14, rig.dist * 0.42);
    const halfW = halfH * camera.aspect;
    orthoCam.left = -halfW; orthoCam.right = halfW;
    orthoCam.top = halfH; orthoCam.bottom = -halfH;
    orthoCam.near = 1; orthoCam.far = 4000;
    orthoCam.updateProjectionMatrix();
    orthoCam.position.set(rig.target.x, 900, rig.target.z);
    orthoCam.lookAt(rig.target.x, 0, rig.target.z);
    retro.update(sim, { cx: rig.target.x, cz: rig.target.z, halfW, halfH });
    renderer.render(scene, orthoCam);
  } else {
    renderer.render(scene, camera);
  }'''
assert s.count(old) == 2, s.count(old)
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("render patch ok")
