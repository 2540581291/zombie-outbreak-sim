import io
p = "js/sim.js"
s = io.open(p, encoding="utf-8").read()

# move()：动画相位按「步幅」推进，而不是按一个拍脑袋的系数
s = s.replace("""      this.heading[i] = a;
      this.phase[i] = (this.phase[i] + dt * speed * 1.9) % 1;
      this.stuck[i] = 0;
      return true;""",
"""      this.heading[i] = a;
      // 步态：一个完整周期走 stride 米。人 1.45m、狗 0.8m、熊 2.4m
      const sp0 = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
      const stride = 1.45 * (sp0.scale || 1);
      this.phase[i] = (this.phase[i] + (speed / stride) * dt) % 1;
      this.stuck[i] = 0;
      return true;""")

# 门场分支里也有一处同样写法
s = s.replace("""          this.heading[i] = a;
          this.phase[i] = (this.phase[i] + dt * speed * 1.9) % 1;
          this.stuck[i] = 0;
          return true;""",
"""          this.heading[i] = a;
          const sp1 = SPECIES[this.kind[i]] || SPECIES[SP.CIV1];
          this.phase[i] = (this.phase[i] + (speed / (1.45 * (sp1.scale || 1))) * dt) % 1;
          this.stuck[i] = 0;
          return true;""")
io.open(p, "w", encoding="utf-8").write(s)
print("sim ok")

# 复古模式：帧序列改用 phase（跟实际速度挂钩），不再用全局时间匀速播
p2 = "js/retro.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""      // 帧序
      let fi = Math.floor(t * FPS) % frames.length;""",
"""      // 帧序：跟着个体自己的步态相位走（站着就不动，走得快就迈得快）
      let fi = Math.floor(sim.phase[i] * frames.length) % frames.length;
      if (st === ST.ZOMBIE || st === ST.WILD) fi = Math.floor((sim.phase[i] * 1.3 + t * 0.2) * frames.length) % frames.length;""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("retro ok")
