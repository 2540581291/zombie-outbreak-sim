import os, json
print("  数据库/cities/berlin/  ", "存在" if os.path.exists("数据库/cities/berlin/city.json") else "缺失")
print("  数据库/cities/index.json", "存在" if os.path.exists("数据库/cities/index.json") else "缺失")
print("  raw/ 里的 PBF:")
for f in os.listdir("pipeline/raw") if os.path.exists("pipeline/raw") else []:
    p = os.path.join("pipeline/raw", f)
    print(f"    {f}  {os.path.getsize(p)/1024/1024:.0f} MB")
