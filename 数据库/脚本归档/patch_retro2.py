import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()

# 4) setRetro 函数 + 按钮（放在 setBuildings 附近）
anchor = "function showBanner(txt) {"
add = '''// ---------- 2009 复古模式 ----------
function setRetro(on) {
  if (!retro || !retro.ready) { console.warn('复古图集未就绪'); return; }
  retroMode = !!on;
  retro.group.visible = retroMode;
  if (cityRef && cityRef.group) cityRef.group.visible = !retroMode && showBuildings;
  if (sky) sky.visible = !retroMode;
  if (agents) {
    agents.points.visible = !retroMode;
    agents.unitsVisible = !retroMode;
  }
  const btn = document.getElementById('btn-retro');
  if (btn) btn.textContent = retroMode ? '🕹 2009 模式' : '🧊 3D 模式';
  document.body.classList.toggle('retro-mode', retroMode);
  if (retroMode && !document.getElementById('retro-hint')) {
    const h = document.createElement('div');
    h.id = 'retro-hint';
    h.textContent = '2009 模式 · Tab 切回 3D';
    document.body.appendChild(h);
  } else if (!retroMode) {
    const h = document.getElementById('retro-hint');
    if (h) h.remove();
  }
}

'''
s = s.replace(anchor, add + anchor, 1)

# 5) 快捷键 Tab
s = s.replace("if (e.code === 'KeyB') setBuildings(!showBuildings);",
"if (e.code === 'KeyB') setBuildings(!showBuildings);\n  if (e.code === 'Tab') { e.preventDefault(); setRetro(!retroMode); }")

# 6) 顶栏按钮
s = s.replace("$('tb-city').textContent = city.name;",
"""$('tb-city').textContent = city.name;
  {
    const tb = $('topbar');
    const b = document.createElement('button');
    b.id = 'btn-retro';
    b.textContent = '🧊 3D 模式';
    b.title = '切换 2009 复古模式（Tab）';
    b.style.cssText = 'margin-left:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
      'color:#cfd6dd;font:inherit;font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer';
    b.onclick = () => setRetro(!retroMode);
    tb && tb.appendChild(b);
  }
  if (Q.get('retro')) setRetro(true);""")

io.open(p, "w", encoding="utf-8").write(s)
print("part2 ok")
