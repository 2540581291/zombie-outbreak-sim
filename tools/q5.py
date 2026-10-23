import io
# 1) 生成器补 bear_z
p = "pipeline/make_animal_sprites.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('''    "tiger": dict(len=13''',
'''    "bear_z": dict(len=13, wid=8.5, leg=4, head_r=3.2, tail=0, ears=1, eyes=(1.0, 0.2, 0.1),
                   body=(0.56, 0.20, 0.13), dark=(0.22, 0.07, 0.05),
                   head=(0.62, 0.24, 0.15), accent=(0.85, 0.30, 0.18)),
    "tiger": dict(len=13''')
io.open(p, "w", encoding="utf-8").write(s)

# 2) retro 映射加 animals_ 前缀
p2 = "js/retro.js"
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("""  [SP.DOG]: 'dog',
  [SP.CAT]: 'cat',
  [SP.BEAR]: 'bear',
  [SP.TIGER]: 'tiger',""",
"""  [SP.DOG]: 'animals_dog',
  [SP.CAT]: 'animals_cat',
  [SP.BEAR]: 'animals_bear',
  [SP.TIGER]: 'animals_tiger',""")
s2 = s2.replace("      const zk = (SPECIES[kind] || {}).zombieKind;",
"      const zk0 = (SPECIES[kind] || {}).zombieKind;\n      const zk = zk0 ? (zk0.startsWith('animals_') ? zk0 : 'animals_' + zk0) : null;")
io.open(p2, "w", encoding="utf-8").write(s2)
print("patched")
