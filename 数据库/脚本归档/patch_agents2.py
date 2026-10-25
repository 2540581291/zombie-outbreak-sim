import io
p = "js/agents.js"
s = io.open(p, encoding="utf-8").read()
start = s.index("    let nearN = 0;\n    const bodyM = this.bodyMesh")
end = s.index("    this.geo.setDrawRange(0, n);")
new = '''    if (!this.unitsVisible) { for (const e of this.kindMeshes.values()) e.n = 0; }
    else for (const e of this.kindMeshes.values()) e.n = 0;

    const dummy = this.dummy;

    for (let i = 0; i < n; i++) {
      const x = px[i], z = pz[i];
      const i3 = i * 3;
      pos[i3] = x; pos[i3 + 1] = 0.9; pos[i3 + 2] = z;

      const st = sim.state[i];
      if (st === ST.SAVED) { hide[i] = 1; continue; }

      const kind = sim.kind ? sim.kind[i] : 0;
      const sp = SPECIES[kind] || SPECIES[SP.CIV1];
      let c = sp.color;
      if (st === ST.INFECTED) c = sp.infectedColor;
      else if (st === ST.CORPSE) c = COLORS[ST.CORPSE];
      else if (st === ST.ZOMBIE) c = COLORS[ST.ZOMBIE];
      col[i3] = c[0]; col[i3 + 1] = c[1]; col[i3 + 2] = c[2];
      size[i] = 3300 * sp.scale;

      let hid = 0;
      const dx = x - camX, dz = z - camZ;
      const d2 = dx * dx + dz * dz;

      if (this.unitsVisible && d2 < nearR2 && st !== ST.CORPSE) {
        const e = this._meshes(kind);
        if (e.n < this.nearCap) {
          const bob = Math.sin(sim.phase[i] * 6.2832) * 0.07 * (st === ST.ZOMBIE ? 1.4 : 1);
          dummy.position.set(x, bob, z);
          dummy.rotation.set(0, -sim.heading[i] + Math.PI / 2, 0);
          const sc = sp.scale;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          dummy.matrix.toArray(e.mesh.instanceMatrix.array, e.n * 16);
          e.n++;
          hid = 1;
        }
      }
      hide[i] = hid;
    }

'''
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("update loop replaced")
