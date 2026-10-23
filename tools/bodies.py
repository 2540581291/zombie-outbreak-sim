import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace("""const TYPE_TO_SPRITE = {""",
"""// 平民可用的体型（原版 6 套人物精灵，去掉警察那套）
const CIV_BODIES = ['guy01', 'guy02', 'girl01', 'girl02', 'fat01'];

const TYPE_TO_SPRITE = {""")

# 平民按个体哈希选体型；士兵/重装用军绿染色的 police01；其余按物种
s = s.replace("""      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';""",
"""      let sprType = TYPE_TO_SPRITE[kind] || 'guy01';
      // 平民：按个体稳定哈希挑体型，让街头看起来是"各种人"而不是一个人复制
      if (kind === SP.CIV1 || kind === SP.CIV2 || kind === SP.CIV3) {
        sprType = CIV_BODIES[(i * 2654435761 >>> 0) % CIV_BODIES.length];
      }""")
io.open(p, "w", encoding="utf-8").write(s)
print("平民体型已随机化")
