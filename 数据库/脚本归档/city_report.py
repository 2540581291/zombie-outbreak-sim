import json, os
idx = json.load(open("数据库/cities/index.json", encoding="utf-8"))
print("id          名称              建筑     尺寸(m)")
for x in idx:
    print(f"  {x['id']:10} {x['name']:16} {x['buildings']:>6} 栋  {x['size'][0]:.0f}x{x['size'][1]:.0f}")
print()
for x in idx:
    p = os.path.join("data", "cities", x["id"], "sat.jpg")
    m = json.load(open(os.path.join("data", "cities", x["id"], "sat.json"), encoding="utf-8"))
    print(f"  {x['id']:10} sat.jpg {m['size'][0]}x{m['size'][1]}  {os.path.getsize(p)/1024/1024:.0f} MB  {m.get('sweetSpot',{}).get('r_eff')} m/px")
