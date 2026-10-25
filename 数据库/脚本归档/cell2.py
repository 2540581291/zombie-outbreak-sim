import io
p = "pipeline/bake_pbf.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("col = collision.build(out, cell=args.cell,  cell=2.0)",
              "col = collision.build(out, cell=args.cell)")
io.open(p, "w", encoding="utf-8").write(s)
print("已去重")
