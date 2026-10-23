import io
# retro.js：动物用专属精灵；尸变后用 *_z
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("  [SP.APC]: 'police01',",
"""  [SP.APC]: 'police01',
  [SP.DOG]: 'dog',
  [SP.CAT]: 'cat',
  [SP.BEAR]: 'bear',
  [SP.TIGER]: 'tiger',""")
s = s.replace("      const sprType = TYPE_TO_SPRITE[kind] || 'guy01';",
"""      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';
      // 狗/猫尸变后换一套红色变体
      const zk = (SPECIES[kind] || {}).zombieKind;
      if (zk && st === ST.ZOMBIE) sprType = zk;""")
io.open(p, "w", encoding="utf-8").write(s)

# 图集重建：把 animals 目录一并收进去
p2 = "tools/build_retro_atlas.py"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace('SRC, OUT = "reference/sprites", "assets/retro"',
                'SRC, OUT = "reference/sprites", "assets/retro"\n# animals 子目录也收进来\nSRC_EXTRA = "reference/sprites/animals"')
s2 = s2.replace("for t in sorted(os.listdir(SRC)):",
"""dirs = []
if os.path.isdir(SRC_EXTRA):
    for a in sorted(os.listdir(SRC_EXTRA)):
        dirs.append(("animals", a, sorted(glob.glob(os.path.join(SRC_EXTRA, a, "*", "*.png")))))
    # 按 anim 拆开
    dirs = []
    for a in sorted(os.listdir(SRC_EXTRA)):
        for anim in sorted(os.listdir(os.path.join(SRC_EXTRA, a))):
            fs = sorted(glob.glob(os.path.join(SRC_EXTRA, a, anim, "*.png")))
            if fs:
                dirs.append(("animals_" + a, anim, fs))
for t, a, fs in dirs:
    files.append((t, a, fs))
for t in sorted(os.listdir(SRC)):""")
io.open(p2, "w", encoding="utf-8").write(s2)
print("patched")
