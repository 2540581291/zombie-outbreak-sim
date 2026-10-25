import io
p = "js/species.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("zombieKind: 'bear_z',", "zombieKind: 'animals_bear_z',")
s = s.replace("zombieKind: 'tiger_z',", "zombieKind: 'animals_tiger_z',")
s = s.replace("zombieKind: 'dog_z',", "zombieKind: 'animals_dog_z',")
s = s.replace("zombieKind: 'cat_z',", "zombieKind: 'animals_cat_z',")
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
