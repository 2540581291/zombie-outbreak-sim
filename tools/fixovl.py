import io
p = "js/overlay.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("      map: tex, transparent: true, depthWrite: false, depthTest: false,",
"      map: tex, transparent: true, depthWrite: false, depthTest: true,")
s = s.replace("    mesh.position.y = 0.6;          // 盖在地面之上、小人之下",
"    mesh.position.y = 0.3;          // 在地面之上、单位之下，不遮住小人")
s = s.replace("    mesh.renderOrder = 3;", "    mesh.renderOrder = 1;")
io.open(p, "w", encoding="utf-8").write(s)
print("overlay ok")
