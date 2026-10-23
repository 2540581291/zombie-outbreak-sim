import io
p = "tools/build_retro_atlas2.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    out[idx, 0] = np.clip(nr, 0, 1)
    out[idx, 1] = np.clip(ng, 0, 1)
    out[idx, 2] = np.clip(nb, 0, 1)""",
"""    r0, c0 = idx
    out[r0, c0, 0] = np.clip(nr, 0, 1)
    out[r0, c0, 1] = np.clip(ng, 0, 1)
    out[r0, c0, 2] = np.clip(nb, 0, 1)""")
io.open(p, "w", encoding="utf-8").write(s)
print("赋值索引已修")
