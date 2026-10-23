import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
anchor = "    b2.onclick = () => setOverlay(!overlayOn);\n    tb && tb.appendChild(b2);"
add = anchor + """

    // 城市选择器（data/cities/index.json 里有多个城市才显示）
    if (cityIndex && cityIndex.length > 1) {
      const sel = document.createElement('select');
      sel.id = 'sel-city';
      sel.title = '切换城市';
      sel.style.cssText = 'margin-left:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
        'color:#cfd6dd;font:inherit;font-size:11px;padding:3px 6px;border-radius:5px;cursor:pointer';
      for (const c of cityIndex) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        if (c.id === CID) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        const u = new URL(location.href);
        u.searchParams.set('city', sel.value);
        location.href = u.toString();
      };
      tb && tb.appendChild(sel);
    }"""
assert anchor in s
s = s.replace(anchor, add, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("城市选择器已加入")
