import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

# 1) import
s = s.replace("import { openReport, closeReport, isReportOpen } from './report.js';",
"import { openReport, closeReport, isReportOpen } from './report.js';\nimport { RetroView } from './retro.js';")

# 2) 全局变量（放在 agents 声明附近）
s = s.replace("let agents = null;",
"let agents = null;\nlet retro = null, retroMode = false, orthoCam = null;")

# 3) 创建复古视图（插在 AgentRenderer 之后）
s = s.replace("  agents = new AgentRenderer(scene, 62000);",
"""  agents = new AgentRenderer(scene, 62000);

  // ---------- 2009 复古模式 ----------
  retro = new RetroView(scene);
  try {
    await retro.load();
  } catch (e) {
    console.warn('[ZOS-R] 复古图集加载失败：', e);
  }
  orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  orthoCam.up.set(0, 0, -1);""")

io.open(p, "w", encoding="utf-8").write(s)
print("part1 ok")
