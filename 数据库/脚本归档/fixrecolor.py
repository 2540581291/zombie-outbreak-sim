import io
p = "tools/build_retro_atlas2.py"
s = io.open(p, encoding="utf-8").read()
old = s[s.index("    idx = np.nonzero(mask)"):s.index("    out[idx, 0] = np.clip(nr, 0, 1)")]
new = """    idx = np.nonzero(mask)
    pix = rgb[idx]                       # (N,3)
    r, g, b = pix[:, 0], pix[:, 1], pix[:, 2]
    mxv = pix.max(1)
    mnv = pix.min(1)
    d2 = mxv - mnv
    nz = d2 > 1e-5
    h2 = np.zeros_like(mxv)
    rr, gg, bb = r[nz], g[nz], b[nz]
    m2 = mxv[nz]
    dd = d2[nz]
    h2[nz] = np.where(m2 == rr, ((gg - bb) / dd) % 6,
                      np.where(m2 == gg, (bb - rr) / dd + 2, (rr - gg) / dd + 4)) / 6.0
    hh = (h2 + dh) % 1.0
    ss = np.where(mxv > 1e-5, d2 / np.maximum(mxv, 1e-5), 0)
    vv = mxv
    ii = np.floor(hh * 6).astype(int) % 6
    f = hh * 6 - np.floor(hh * 6)
    p_ = vv * (1 - ss)
    q = vv * (1 - f * ss)
    t = vv * (1 - (1 - f) * ss)
    conds = [ii == 0, ii == 1, ii == 2, ii == 3, ii == 4, ii == 5]
    nr = np.select(conds, [vv, q, p_, p_, t, vv])
    ng = np.select(conds, [t, vv, vv, q, p_, p_])
    nb = np.select(conds, [p_, p_, t, vv, vv, q])
"""
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("索引已修")
