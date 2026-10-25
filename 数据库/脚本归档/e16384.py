import io
p = "tools/pick_size.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("E_MAX = 32768              # 显卡 MAX_TEXTURE_SIZE（18432 已验证可用）",
"E_MAX = 16384              # 实测：ANGLE/D3D11 把单边锁在 16384（RTX 5090 硬件支持 32768 但浏览器不给）")
s = s.replace("P_MAX = int(2 ** 28 * 0.95)  # 268.4 MP 再留 5% 余量 ≈ 255 MP（z19 的 264MP 已验证可过）",
"P_MAX = int(2 ** 28 * 0.95)  # 非瓶颈：边长上限先触发，这里只作兜底")
io.open(p, "w", encoding="utf-8").write(s)
print("E_MAX → 16384（实测值）")
