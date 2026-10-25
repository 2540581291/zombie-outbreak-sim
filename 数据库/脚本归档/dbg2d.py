import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("    renderer.render(scene, orthoCam);\n  } else {",
"""    if (++fc % 15 === 0) document.title = 'RETRO n=' + retro.count + ' half=' + halfH.toFixed(0) +
      ' halfW=' + halfW.toFixed(0) + ' py=' + (window.innerHeight / (2 * halfH)).toFixed(2);
    renderer.render(scene, orthoCam);
  } else {""")
io.open(p, "w", encoding="utf-8").write(s)
print("调试标题已加")
