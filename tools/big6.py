import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("const MIN_SCREEN_PX = 3.2;", "const MIN_SCREEN_PX = 6.0;")
io.open(p, "w", encoding="utf-8").write(s)
p2 = "js/main.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""    if (++fc % 15 === 0) document.title = 'RETRO n=' + retro.count + ' half=' + halfH.toFixed(0) +
      ' halfW=' + halfW.toFixed(0) + ' py=' + (window.innerHeight / (2 * halfH)).toFixed(2);
""", "")
io.open(p2, "w", encoding="utf-8").write(s2)
print("最小 6px，调试标题已移除")
