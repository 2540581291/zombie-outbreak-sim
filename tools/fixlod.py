import io
# 1) agents.js：给每个个体加 nearFlag，带 25% 滞回，避免在边界上反复切换
p = "js/agents.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("    this.unitsVisible = true;",
"    this.unitsVisible = true;\n    this.nearFlag = new Uint8Array(62000);   // 滞回：已经显示为模型的个体不会在边界抖动")
s = s.replace("    const nearR2 = this.nearRadius * this.nearRadius;",
"    const rIn = this.nearRadius;\n    const rOut = this.nearRadius * 1.3;      // 出圈要比进圈远 30%，防止抖动\n    const rIn2 = rIn * rIn, rOut2 = rOut * rOut;")
s = s.replace("      if (this.unitsVisible && d2 < nearR2 && st !== ST.CORPSE) {",
"      const wasNear = this.nearFlag[i] === 1;\n      const isNear = d2 < (wasNear ? rOut2 : rIn2);\n      if (this.unitsVisible && isNear && st !== ST.CORPSE) {\n        this.nearFlag[i] = 1;")
s = s.replace("      hide[i] = hid;","      if (!isNear) this.nearFlag[i] = 0;\n      hide[i] = hid;")
io.open(p, "w", encoding="utf-8").write(s)
print("agents ok")

# 2) main.js：半径随视距连续变化，不再有 200 米硬阈值
p2 = "js/main.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("    agents.nearRadius = rig.dist < 200 ? 240 : 0;",
"    // 视距越大，显示模型的半径也越大（连续，避免整片突变）\n    agents.nearRadius = Math.min(1400, Math.max(110, rig.dist * 0.9));")
io.open(p2, "w", encoding="utf-8").write(s2)
print("main ok")
