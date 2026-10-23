import io
p = "js/retro.js"
s = io.open(p, encoding="utf-8").read()
old = """    const chain = [
      `${type}/${anim}_solid`,
      `${type}/walk_solid`,
      `${type}/idle01_solid`,
      `fat01/${anim}_solid`,       // fat01 的丧尸动画最全
      `fat01/walk_solid`,
    ];"""
new = """    // 只在同一体型内兜底 —— 跨体型会让人物"变形成胖子"
    const chain = [
      `${type}/${anim}_solid`,
      `${type}/walk_solid`,
      `${type}/idle01_solid`,
      `${type}/zattack01_solid`,   // 丧尸缺 zwalk 时用它，至少肢体是红的
    ];"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("兜底链已限制在同体型内")
