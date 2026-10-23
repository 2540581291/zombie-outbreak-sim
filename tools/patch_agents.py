import io, re
p = "js/agents.js"
s = io.open(p, encoding="utf-8").read()
start = s.index("    this.bodyMesh = new THREE.InstancedMesh(body, mat, NEAR);")
end = s.index("    this.dummy = new THREE.Object3D();")
s = s[:start] + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("removed stale bodyMesh block")
