import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace("import { RetroView } from './retro.js';",
"import { RetroView } from './retro.js';\nimport { TerrainOverlay } from './overlay.js';")

s = s.replace("let retro = null, retroMode = false, orthoCam = null;",
"let retro = null, retroMode = false, orthoCam = null;\nlet overlay = null, overlayOn = false;")

# 建 overlay（在 nav 就绪之后，用 cityRef）
s = s.replace("  orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);",
"""  overlay = new TerrainOverlay(scene, nav, city);
  console.log('[ZOS-R] 地形图层：不可通行 ' + overlay.stats.block.toLocaleString() +
    ' / ' + overlay.stats.total.toLocaleString() + ' 格 (' + overlay.stats.pct.toFixed(1) + '%)');

  orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);""")

# 切换函数
s = s.replace("// ---------- 2009 复古模式 ----------",
"""// ---------- 地形图层 ----------
function setOverlay(on) {
  if (!overlay) return;
  overlayOn = !!on;
  overlay.visible = overlayOn;
  const b = document.getElementById('btn-overlay');
  if (b) b.textContent = overlayOn ? '🗺 地形' : '🗺 地形';
  if (overlayOn && !document.getElementById('overlay-legend')) {
    const d = document.createElement('div');
    d.id = 'overlay-legend';
    d.innerHTML =
      '<b>地形图层</b>' +
      '<span><i style="background:#e61919"></i>墙 / 栅栏（不可走）</span>' +
      '<span><i style="background:#1a66ff"></i>水（不可走）</span>' +
      '<span><i style="background:#f2cc26"></i>围栏（不可走，通视线）</span>' +
      '<span><i style="background:#33f2f2"></i>窗（不可走，通视线）</span>' +
      '<span><i style="background:#33ff59"></i>门（可走）</span>' +
      '<span><i style="background:#ff8c1a"></i>室内（可走）</span>' +
      '<span><i style="background:#33b340"></i>林地（可走）</span>' +
      '<span style="opacity:.5">不可通行 ' + overlay.stats.pct.toFixed(1) + '%</span>';
    document.body.appendChild(d);
  } else if (!overlayOn) {
    const d = document.getElementById('overlay-legend');
    if (d) d.remove();
  }
}

// ---------- 2009 复古模式 ----------""")

# 快捷键 C
s = s.replace("  if (e.code === 'Tab') { e.preventDefault(); setRetro(!retroMode); }",
"  if (e.code === 'Tab') { e.preventDefault(); setRetro(!retroMode); }\n  if (e.code === 'KeyC') setOverlay(!overlayOn);")

# 顶栏按钮
s = s.replace("    b.onclick = () => setRetro(!retroMode);\n    tb && tb.appendChild(b);",
"""    b.onclick = () => setRetro(!retroMode);
    tb && tb.appendChild(b);

    const b2 = document.createElement('button');
    b2.id = 'btn-overlay';
    b2.textContent = '🗺 地形';
    b2.title = '叠加地形图层（C）：显示每格能不能走';
    b2.style.cssText = b.style.cssText + ';margin-left:6px';
    b2.onclick = () => setOverlay(!overlayOn);
    tb && tb.appendChild(b2);""")

s = s.replace("  if (Q.get('retro')) setRetro(true);",
"  if (Q.get('retro')) setRetro(true);\n  if (Q.get('overlay')) setOverlay(true);")
io.open(p, "w", encoding="utf-8").write(s)
print("main patched")
