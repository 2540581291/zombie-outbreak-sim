import io
p = "index.html"
s = io.open(p, encoding="utf-8").read()
anchor = '    <div class="p-btns">'
add = '''    <div class="p-sec">生物</div>
    <label class="p-row"><span>狗</span><input type="range" id="s-dog" min="0" max="1200" step="20" value="240"><b id="v-dog">240</b></label>
    <label class="p-row"><span>猫</span><input type="range" id="s-cat" min="0" max="1200" step="20" value="160"><b id="v-cat">160</b></label>
    <label class="p-row"><span>熊</span><input type="range" id="s-bear" min="0" max="40" step="1" value="3"><b id="v-bear">3</b></label>
    <label class="p-row"><span>老虎</span><input type="range" id="s-tiger" min="0" max="40" step="1" value="2"><b id="v-tiger">2</b></label>
    <label class="p-row"><span>动物感染率</span><input type="range" id="s-ainf" min="0" max="100" step="5" value="15"><b id="v-ainf">15%</b></label>
'''
assert anchor in s
s = s.replace(anchor, add + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("html ok")

p2 = "js/main.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("const sArm = $('s-arm'), sPol = $('s-pol'), sPacc = $('s-pacc');",
"const sArm = $('s-arm'), sPol = $('s-pol'), sPacc = $('s-pacc');\nconst sDog = $('s-dog'), sCat = $('s-cat'), sBear = $('s-bear'), sTiger = $('s-tiger'), sAinf = $('s-ainf');")
s2 = s2.replace("    policeAccuracy: +sPacc.value / 100,\n  };",
"    policeAccuracy: +sPacc.value / 100,\n    dogs: +sDog.value, cats: +sCat.value,\n    bears: +sBear.value, tigers: +sTiger.value,\n    animalInfected: +sAinf.value / 100,\n  };")
s2 = s2.replace("  $('v-pacc').textContent = sPacc.value + '%';",
"""  $('v-pacc').textContent = sPacc.value + '%';
  $('v-dog').textContent = sDog.value;
  $('v-cat').textContent = sCat.value;
  $('v-bear').textContent = sBear.value;
  $('v-tiger').textContent = sTiger.value;
  $('v-ainf').textContent = sAinf.value + '%';""")
s2 = s2.replace("[sPop, sZ0, sZspd, sInc, sArm, sPol, sPacc].forEach(s => s.addEventListener('input', syncLabels));",
"[sPop, sZ0, sZspd, sInc, sArm, sPol, sPacc, sDog, sCat, sBear, sTiger, sAinf].forEach(s => s.addEventListener('input', syncLabels));")
io.open(p2, "w", encoding="utf-8").write(s2)
print("main ok")
