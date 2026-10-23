from PIL import Image, ImageDraw, ImageFont
import os
try:
    F  = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
    FB = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
except Exception:
    F = FB = ImageFont.load_default()

W, H = 1210, 800
c = Image.new("RGBA", (W, H), (16, 18, 22, 255))
d = ImageDraw.Draw(c)

def lab(x, y, t, col=(210, 220, 230, 255), f=None):
    d.text((x, y), t, fill=col, font=f or F)

# ---- 第一行：原版 / HD / 剪影 ----
y = 12
lab(14, y, "① 原版 15×14（最近邻 ×8）")
lab(300, y, "② 高清重制 ×8", (255, 180, 120, 255))
lab(560, y, "③ 绿色剪影（遮挡透视）", (120, 230, 150, 255))
src = Image.open("reference/sprites/police01/walk_solid/00.png").convert("RGBA")
c.alpha_composite(src.resize((src.width * 8, src.height * 8), Image.NEAREST), (14, y + 26))
hd = Image.open("assets/sprites_hd/police01/walk_solid/00.png").convert("RGBA")
c.alpha_composite(hd, (300, y + 26))
sil = Image.open("assets/sprites_hd/police01/walk_outline/00.png").convert("RGBA")
c.alpha_composite(sil, (560, y + 26))
lab(760, y + 60, "被建筑挡住时透出的轮廓", (120, 150, 130, 255))
lab(760, y + 84, "原版用这套做 X 光透视", (120, 150, 130, 255))

# ---- 第二行：配色变体 ----
y = 190
lab(14, y, "④ 同一帧的 8 套配色（guy01 走路）")
x = 14
for v in ["orig", "warm", "olive", "teal", "blue", "violet", "crimson", "pale"]:
    p = ("assets/sprites_hd/guy01/walk_solid/00.png" if v == "orig"
         else f"assets/sprites_var/guy01/{v}/walk_solid/00.png")
    im = Image.open(p).convert("RGBA")
    c.alpha_composite(im.resize((160, 150), Image.NEAREST), (x, y + 28))
    lab(x, y + 186, v, (140, 150, 160, 255))
    x += 148

# ---- 第三行：走路循环 ----
y = 410
lab(14, y, "⑤ 走路循环 8 帧：上 原版（×4）  下 高清（×1）")
x = 14
for i in range(8):
    im = Image.open(f"reference/sprites/police01/walk_solid/{i:02d}.png").convert("RGBA")
    c.alpha_composite(im.resize((im.width * 4, im.height * 4), Image.NEAREST), (x, y + 28))
    x += im.width * 4 + 8
x = 14
for i in range(8):
    im = Image.open(f"assets/sprites_hd/police01/walk_solid/{i:02d}.png").convert("RGBA")
    c.alpha_composite(im, (x, y + 160))
    x += im.width + 6

c.save("shots/sprites/final_hd.png")
print("写出 shots/sprites/final_hd.png", c.size)
