import io
p = "tools/pick_size.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("P_MAX = 2 ** 28            # 浏览器单图解码上限 ≈ 268.4 MP（实测 z19 的 264MP 可过）",
"P_MAX = int(2 ** 28 * 0.95)  # 268.4 MP 再留 5% 余量 ≈ 255 MP（z19 的 264MP 已验证可过）")
io.open(p, "w", encoding="utf-8").write(s)
print("P_MAX → 255 MP")
