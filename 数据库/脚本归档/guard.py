import io
p = "tools/pick_size.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    W_px = int(round(w_m / r_eff))
    H_px = int(round(h_m / r_eff))""",
"""    W_px = int(round(w_m / r_eff))
    H_px = int(round(h_m / r_eff))
    # 取整后可能轻微越界，回收到上限以内
    guard = 0
    while W_px * H_px > n_use and guard < 200:
        W_px = int(W_px * 0.9995); H_px = int(H_px * 0.9995); guard += 1
    r_eff = w_m / W_px""")
io.open(p, "w", encoding="utf-8").write(s)
print("guard added")
