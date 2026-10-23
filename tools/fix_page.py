import io
p = "tools/gpu_limits.html"
s = io.open(p, encoding="utf-8").read()

s = s.replace("""<table id="t"><thead><tr><th>尺寸</th><th>像素</th><th>显存</th><th>结果</th><th>耗时</th></tr></thead><tbody></tbody></table>""",
"""<table id="t"><thead><tr><th>尺寸</th><th>像素</th><th>显存</th><th>纹理分配</th><th>画布上传</th></tr></thead><tbody></tbody></table>""")

s = s.replace("""  function alloc(w, h) {""",
"""  // A: 只分配纹理存储（走驱动，不经过 canvas）
  function allocTex(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const err = gl.getError();
    gl.deleteTexture(tex);
    return err;
  }
  // B: 从 canvas 上传（受画布尺寸上限约束）
  function alloc(w, h) {""")

s = s.replace("""    let r;
    try { r = alloc(w, h); } catch (e) { r = { ok: false, err: e.message, ms: 0 }; }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${w} × ${h}</td><td>${(px / 1e6).toFixed(0)} MP</td>
      <td>${gb.toFixed(2)} GB</td>
      <td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ 成功' : '✗ 失败 ' + r.err}</td>
      <td>${r.ms.toFixed(0)} ms</td>`;
    tb.appendChild(tr);
    if (r.ok) best = Math.max(best, px);""",
"""    let eA = -1, eB = 'skip';
    try { eA = allocTex(w, h); } catch (e) { eA = 'throw'; }
    let r = { ok: false, ms: 0 };
    try { r = alloc(w, h); eB = r.ok ? 'ok' : String(r.err); } catch (e) { eB = 'throw'; }
    const okA = eA === 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${w} × ${h}</td><td>${(px / 1e6).toFixed(0)} MP</td>
      <td>${gb.toFixed(2)} GB</td>
      <td class="${okA ? 'ok' : 'bad'}">${okA ? '✓' : '✗ ' + eA}</td>
      <td class="${eB === 'ok' ? 'ok' : 'bad'}">${eB === 'ok' ? '✓' : '✗ ' + eB}</td>`;
    tb.appendChild(tr);
    if (okA) best = Math.max(best, px);""")
io.open(p, "w", encoding="utf-8").write(s)
print("测试页已拆成两个指标")
