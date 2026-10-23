import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

# 1) 统一取"当前正在用的相机"
s = s.replace("// 用当前选中的工具打一下",
"""// 当前用于拾取的相机（2D 模式必须用正交相机，否则点击位置会整体偏移）
function activeCamera() {
  return (retroMode && orthoCam) ? orthoCam : camera;
}

// 用当前选中的工具打一下""")
s = s.replace("    rc.setFromCamera(ndc, camera);", "    rc.setFromCamera(ndc, activeCamera());")

# 2) 2D 相机跟随 yaw（不然转过视角一切换就"回正"）
s = s.replace("    orthoCam.position.set(rig.target.x, 900, rig.target.z);\n    orthoCam.lookAt(rig.target.x, 0, rig.target.z);",
"""    orthoCam.position.set(rig.target.x, 900, rig.target.z);
    orthoCam.up.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));   // 跟着 3D 的朝向转
    orthoCam.lookAt(rig.target.x, 0, rig.target.z);""")

# 3) 切换时换算缩放，保持可见范围不变，不再"跳一下"
s = s.replace("function setRetro(on) {\n  if (!retro || !retro.ready) { console.warn('复古图集未就绪'); return; }\n  retroMode = !!on;",
"""function setRetro(on) {
  if (!retro || !retro.ready) { console.warn('复古图集未就绪'); return; }
  const next = !!on;
  if (next !== retroMode) {
    // 3D 视高 ≈ 0.975×dist；2D 视高 = 2×0.095×dist → 换算系数约 5.13
    rig.dist = next ? Math.min(4200, rig.dist * 5.13) : Math.max(26, rig.dist / 5.13);
  }
  retroMode = next;""")

# 4) 滚轮范围按模式区分
s = s.replace("  rig.dist = Math.max(26, Math.min(4200, rig.dist * f));",
"""  const lo = retroMode ? 55 : 26;
  rig.dist = Math.max(lo, Math.min(4200, rig.dist * f));""")
io.open(p, "w", encoding="utf-8").write(s)
print("patched")
