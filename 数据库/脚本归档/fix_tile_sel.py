import io
p = "js/ground.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""    const R = Math.max(cam.halfW || 0, cam.halfH || 0) * 1.5 + 200;
    const cx = cam.cx, cz = cam.cz;
    const per = (this.el - this.wl) * this.kx / this.cols;     // 每块宽（米）
    const perZ = (this.nl - this.sl) * this.ky / this.rows;

    const c0 = Math.max(0, Math.floor((cx - R) / per + this.cols / 2));
    const c1 = Math.min(this.cols - 1, Math.ceil((cx + R) / per + this.cols / 2));
    const r0 = Math.max(0, Math.floor((cz - R) / perZ + this.rows / 2));
    const r1 = Math.min(this.rows - 1, Math.ceil((cz + R) / perZ + this.rows / 2));""",
"""    const R = Math.max(cam.halfW || 0, cam.halfH || 0) * 1.5 + 200;
    const cx = cam.cx, cz = cam.cz;
    // 用整幅图的世界包围盒换算，不假设它以原点对称
    const x0w = (this.wl - this.lon0) * this.kx;
    const x1w = (this.el - this.lon0) * this.kx;
    const z0w = -((this.nl - this.lat0) * this.ky);
    const z1w = -((this.sl - this.lat0) * this.ky);
    const perX = (x1w - x0w) / this.cols;
    const perZ = (z1w - z0w) / this.rows;

    const c0 = Math.max(0, Math.floor((cx - R - x0w) / perX));
    const c1 = Math.min(this.cols - 1, Math.ceil((cx + R - x0w) / perX));
    const r0 = Math.max(0, Math.floor((cz - R - z0w) / perZ));
    const r1 = Math.min(this.rows - 1, Math.ceil((cz + R - z0w) / perZ));""")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
